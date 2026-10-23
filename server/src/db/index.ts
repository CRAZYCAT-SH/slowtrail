import fs from 'fs';
import path from 'path';
import { SqliteDatabase } from './sqliteAdapter';

// 对外沿用 Database 这个名字，避免 service 层感知底层驱动
export type Database = SqliteDatabase;

// 数据库文件路径（支持通过环境变量覆盖，用于 Electron 打包模式）
const DB_DIR = process.env.DB_DIR_OVERRIDE || path.resolve(__dirname, '../../data');
const DB_PATH = path.resolve(DB_DIR, 'slow_queries.db');

let db: SqliteDatabase | null = null;

/**
 * 初始化 SQLite 数据库
 * - 打开（不存在则创建）数据库文件，由 better-sqlite3 直接读写磁盘
 * - 自动创建表和索引
 * - 执行迁移（为已有表补列、重建约束等）
 *
 * 保持 async 签名是为了兼容既有调用方（原 sql.js 需要异步加载 WASM）
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // 确保数据目录存在
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new SqliteDatabase(DB_PATH);

  applyPragmas(db);

  // 创建表结构（新表 + 已有表的 IF NOT EXISTS）
  createTables(db);

  // 执行迁移（为已有数据库补列、重建约束）
  runMigrations(db);

  // 确保查询规划器有统计信息可用
  ensureQueryStatistics(db);

  console.log('[DB] SQLite 数据库初始化完成:', DB_PATH);
  return db;
}

/**
 * 首次启动时收集查询统计信息
 *
 * 这一步不是可选的优化：没有 sqlite_stat1，SQLite 会假定各索引的选择性相近，
 * 于是在带 db_name / instance_name 筛选时优先选中等值索引（idx_db_name 等），
 * 放弃覆盖索引并退化为逐行回表。而实际数据里单个 db_name 可能占七成以上行，
 * 这个选择会让查询慢一个数量级。
 */
function ensureQueryStatistics(database: SqliteDatabase): void {
  // sqlite_stat1 由 ANALYZE 自动创建，它不存在即说明尚未收集过
  if (hasTable(database, 'sqlite_stat1')) {
    const result = database.exec(`SELECT idx FROM sqlite_stat1 WHERE tbl = 'slow_queries'`);
    if (result.length > 0) {
      const recorded = new Set(result[0].values.map((row) => row[0] as string | null));
      // 统计信息必须覆盖当前所有分析索引，且不能残留已删除索引的记录，
      // 否则规划器会按过时的选择性做判断
      const covered = ANALYTICS_INDEXES.every((i) => recorded.has(i.name));
      const stale = OBSOLETE_INDEXES.some((n) => recorded.has(n));
      if (covered && !stale) return;
    }
  }
  analyzeDatabase();
}

/**
 * 刷新查询规划器的统计信息
 * 数据量或分布明显变化后（如完成一次同步）应调用，否则规划器可能沿用过时的选择性判断
 */
export function analyzeDatabase(): void {
  if (!db) return;
  try {
    const t0 = Date.now();
    db.run('ANALYZE');
    console.log(`[DB] 查询统计信息已更新 (ANALYZE)，耗时 ${Date.now() - t0}ms`);
  } catch (error) {
    // 统计信息只影响性能不影响正确性，失败不应中断主流程
    console.error('[DB] ANALYZE 失败:', (error as Error).message);
  }
}

/**
 * 设置连接级 PRAGMA
 *
 * WAL 模式让读写不再互相阻塞（同步任务在写、前端在查统计时尤其重要），
 * 且写入不需要重写整个数据库文件。
 */
function applyPragmas(database: SqliteDatabase): void {
  // WAL：写前日志，读写并发，崩溃后可自动恢复
  database.pragma('journal_mode = WAL');
  // NORMAL：WAL 下不会损坏数据库，仅极端断电时可能丢最后几个事务，对分析工具足够
  database.pragma('synchronous = NORMAL');
  // 负值表示以 KB 为单位，这里约 64MB 页缓存
  database.pragma('cache_size = -64000');
  // 临时表放内存，加速 GROUP BY / ORDER BY
  database.pragma('temp_store = MEMORY');
  // 256MB 内存映射，显著加快大表顺序扫描
  database.pragma('mmap_size = 268435456');
  // 遇到锁等待 5 秒再报错，避免调度任务与 HTTP 请求撞车直接失败
  database.pragma('busy_timeout = 5000');
}

/**
 * 创建数据库表和索引
 */
function createTables(database: Database): void {
  // 慢查询表
  database.run(`
    CREATE TABLE IF NOT EXISTS slow_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_sql TEXT,
      fingerprint TEXT,
      query_time REAL,
      lock_time REAL,
      rows_examined INTEGER,
      rows_sent INTEGER,
      db_name TEXT,
      instance_name TEXT,
      instance_id TEXT,
      node_id TEXT,
      user_name TEXT,
      user_host TEXT,
      timestamp INTEGER,
      es_index TEXT,
      data_source_id INTEGER,
      sync_date TEXT
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON slow_queries(timestamp)`);
  // 注意：以下单列索引已被刻意移除，不要再加回来（原因见 createAnalyticsIndexes 的说明）
  //   idx_fingerprint(fingerprint)      —— 被 idx_sq_fp_cover 的最左前缀覆盖
  //   idx_db_name(db_name)              —— 存在时会把 GROUP BY db_name 引向回表，反而慢一个数量级
  //   idx_instance_name(instance_name)  —— 同上
  createAnalyticsIndexes(database);
  // idx_sq_ds_inst_date 在 runMigrations 中创建（因为已有数据库可能还没有 data_source_id 列）

  // 同步历史表（新结构）
  database.run(`
    CREATE TABLE IF NOT EXISTS sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_source_id INTEGER,
      instance_name TEXT,
      sync_date TEXT,
      source_ref TEXT,
      synced_at INTEGER,
      record_count INTEGER,
      trigger_type TEXT DEFAULT 'manual',
      UNIQUE(data_source_id, instance_name, sync_date)
    )
  `);

  // idx_sh_ds_date 在 runMigrations 中创建（已有旧结构 sync_history 可能还没有 data_source_id 列）

  // 数据源配置表
  database.run(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      settings TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 定时同步任务表（与数据源 1:N 关系）
  database.run(`
    CREATE TABLE IF NOT EXISTS schedule_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_source_id INTEGER NOT NULL,
      instance_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      days_offset INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_st_ds_id ON schedule_tasks(data_source_id)`);

  // 指纹归类 — 分类表
  database.run(`
    CREATE TABLE IF NOT EXISTS fingerprint_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER
    )
  `);

  // 指纹归类 — 分类成员表（一个指纹只能属于一个分类）
  database.run(`
    CREATE TABLE IF NOT EXISTS fingerprint_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      UNIQUE(fingerprint)
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_fgm_group_id ON fingerprint_group_members(group_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_fgm_fingerprint ON fingerprint_group_members(fingerprint)`);
}

/** 统计分析覆盖索引的定义，迁移时用于比对已有索引是否需要重建 */
const ANALYTICS_INDEXES: Array<{ name: string; columns: string[] }> = [
  // 时间范围维度：服务 overview / trends / distribution / heatmap 等按时间筛选的聚合
  {
    name: 'idx_sq_ts_cover',
    columns: ['timestamp', 'fingerprint', 'query_time', 'lock_time', 'rows_examined', 'rows_sent', 'db_name', 'instance_name'],
  },
  // 指纹维度：服务 GROUP BY fingerprint 的聚合与指纹详情
  {
    name: 'idx_sq_fp_cover',
    columns: ['fingerprint', 'timestamp', 'query_time', 'lock_time', 'rows_examined', 'db_name', 'instance_name'],
  },
];

/**
 * 单列索引黑名单
 *
 * 这些索引不但冗余，存在时还会主动损害性能：SQLite 会为了让 GROUP BY db_name
 * 少一次排序而选中 idx_db_name，然后逐行回表校验 timestamp。而 slow_queries 的行
 * 平均含 7KB 的 query_sql，回表代价极高 —— 实测 distribution 因此从 130ms 退化到 1303ms。
 * 删掉它们后规划器只能走覆盖索引，反而是最优解。
 */
const OBSOLETE_INDEXES = ['idx_fingerprint', 'idx_db_name', 'idx_instance_name'];

/**
 * 建立统计分析用的覆盖索引
 *
 * slow_queries 的行很大（query_sql 平均约 7KB），一旦查询需要回表就会读入大量页，
 * 因此这两个索引刻意把聚合要用的列全部包含进来，让查询「只读索引不回表」。
 * 列顺序遵循「过滤/分组列在前，仅供覆盖的列在后」。
 *
 * 两点前提，缺一索引就白建：
 * 1. 聚合里不能出现 query_sql（如 MIN(query_sql)），否则必然回表
 * 2. 必须有 ANALYZE 统计信息，否则规划器不会选中这两个索引（见 ensureQueryStatistics）
 */
function createAnalyticsIndexes(database: SqliteDatabase): void {
  for (const { name, columns } of ANALYTICS_INDEXES) {
    database.run(`CREATE INDEX IF NOT EXISTS ${name} ON slow_queries(${columns.join(', ')})`);
  }
}

/**
 * 读取索引的列构成（按索引内顺序）
 */
function indexColumns(database: Database, index: string): string[] {
  const result = database.exec(`PRAGMA index_info(${index})`);
  if (result.length === 0) return [];
  // PRAGMA index_info 每行为 (seqno, cid, name)，已按 seqno 排序
  return result[0].values.map((row) => row[2] as string);
}

/**
 * 检查表中是否存在某列
 */
function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  if (result.length === 0) return false;
  return result[0].values.some((row) => row[1] === column);
}

/**
 * 检查数据库中是否存在某表
 */
function hasTable(database: Database, table: string): boolean {
  const result = database.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table]
  );
  return result.length > 0 && result[0].values.length > 0;
}

/**
 * 检查数据库中是否存在某索引
 */
function hasIndex(database: Database, index: string): boolean {
  const result = database.exec(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    [index]
  );
  return result.length > 0 && result[0].values.length > 0;
}

/**
 * 检查 sync_history 是否为旧结构（含 index_name 列）
 */
function isSyncHistoryOldSchema(database: Database): boolean {
  return hasColumn(database, 'sync_history', 'index_name');
}

/**
 * 从 es_index 字段值反解出日期字符串 YYYY-MM-DD
 * 尝试匹配尾部的 YYYY.MM.DD 或 YYYYMMDD 模式
 */
function parseSyncDateFromIndex(esIndex: string | null): string | null {
  if (!esIndex) return null;
  // 匹配 YYYY.MM.DD 结尾
  const dotMatch = esIndex.match(/(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2]}-${dotMatch[3]}`;
  }
  // 匹配 YYYY-MM-DD 结尾
  const dashMatch = esIndex.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
  }
  // 匹配 YYYYMMDD 结尾
  const compactMatch = esIndex.match(/(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }
  return null;
}

/**
 * 从毫秒时间戳计算本地日期字符串 YYYY-MM-DD
 */
function dateFromTimestamp(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 执行数据库迁移
 * - 为已有 slow_queries 表补 data_source_id / sync_date 列
 * - 重建 sync_history 表（旧结构 → 新结构）
 * 全程包事务，异常回滚
 */
function runMigrations(database: Database): void {
  let migrated = false;

  database.run('BEGIN TRANSACTION');

  try {
    // === 迁移 1: slow_queries 补列 ===
    if (!hasColumn(database, 'slow_queries', 'data_source_id')) {
      console.log('[DB Migration] slow_queries: 补充 data_source_id 列');
      database.run('ALTER TABLE slow_queries ADD COLUMN data_source_id INTEGER');
      migrated = true;
    }

    if (!hasColumn(database, 'slow_queries', 'sync_date')) {
      console.log('[DB Migration] slow_queries: 补充 sync_date 列');
      database.run('ALTER TABLE slow_queries ADD COLUMN sync_date TEXT');

      // 从 es_index 反解回填 sync_date
      console.log('[DB Migration] slow_queries: 从 es_index 回填 sync_date ...');
      const rows = database.exec('SELECT id, es_index, timestamp FROM slow_queries WHERE sync_date IS NULL');
      if (rows.length > 0) {
        let filled = 0;
        let fallback = 0;
        for (const row of rows[0].values) {
          const id = row[0] as number;
          const esIndex = row[1] as string | null;
          const ts = row[2] as number | null;

          let syncDate = parseSyncDateFromIndex(esIndex);
          if (!syncDate && ts) {
            syncDate = dateFromTimestamp(ts);
            fallback++;
          }
          if (syncDate) {
            database.run('UPDATE slow_queries SET sync_date = ? WHERE id = ?', [syncDate, id]);
            filled++;
          }
        }
        console.log(`[DB Migration] slow_queries: sync_date 回填完成 (${filled} 条, 其中 ${fallback} 条从 timestamp 推断)`);
      }
      migrated = true;
    }

    // 补建复合索引（无论是否刚加列，确保索引存在）
    database.run('CREATE INDEX IF NOT EXISTS idx_sq_ds_inst_date ON slow_queries(data_source_id, instance_name, sync_date)');

    // === 迁移 2: sync_history 重建 ===
    if (isSyncHistoryOldSchema(database)) {
      console.log('[DB Migration] sync_history: 从旧结构迁移到新结构...');

      // 建新表
      database.run(`
        CREATE TABLE sync_history_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data_source_id INTEGER,
          instance_name TEXT,
          sync_date TEXT,
          source_ref TEXT,
          synced_at INTEGER,
          record_count INTEGER,
          UNIQUE(data_source_id, instance_name, sync_date)
        )
      `);

      // 迁移数据：index_name → source_ref，从 index_name 反解 sync_date
      const oldRows = database.exec('SELECT id, instance_name, index_name, synced_at, record_count FROM sync_history');
      if (oldRows.length > 0) {
        for (const row of oldRows[0].values) {
          const instanceName = row[1] as string;
          const indexName = row[2] as string;
          const syncedAt = row[3] as number;
          const recordCount = row[4] as number;

          let syncDate = parseSyncDateFromIndex(indexName);
          if (!syncDate) {
            // 如果无法从索引名反解日期，用同步时间做退化处理
            syncDate = dateFromTimestamp(syncedAt);
          }

          // data_source_id 暂为 NULL，Task 4 的 initDefaultDataSource 会回填
          database.run(
            `INSERT OR IGNORE INTO sync_history_new (data_source_id, instance_name, sync_date, source_ref, synced_at, record_count)
             VALUES (NULL, ?, ?, ?, ?, ?)`,
            [instanceName, syncDate, indexName, syncedAt, recordCount]
          );
        }
      }

      // 删除旧表、重命名新表
      database.run('DROP TABLE sync_history');
      database.run('ALTER TABLE sync_history_new RENAME TO sync_history');
      database.run('CREATE INDEX IF NOT EXISTS idx_sh_ds_date ON sync_history(data_source_id, sync_date)');

      console.log('[DB Migration] sync_history: 迁移完成');
      migrated = true;
    }

    // === 迁移 3: data_sources 补充定时调度字段（历史迁移，保留兼容） ===
    if (!hasColumn(database, 'data_sources', 'schedule_enabled')) {
      // 新库不再有这些列，跳过
    }

    // === 迁移 4: sync_history 补充 trigger_type 字段 ===
    if (!hasColumn(database, 'sync_history', 'trigger_type')) {
      console.log('[DB Migration] sync_history: 补充 trigger_type 列');
      database.run("ALTER TABLE sync_history ADD COLUMN trigger_type TEXT DEFAULT 'manual'");
      migrated = true;
    }

    // === 迁移 5: 创建 schedule_tasks 表，并从 data_sources 迁移旧定时配置 ===
    if (!hasTable(database, 'schedule_tasks')) {
      console.log('[DB Migration] 创建 schedule_tasks 表');
      database.run(`
        CREATE TABLE schedule_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data_source_id INTEGER NOT NULL,
          instance_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          interval_minutes INTEGER NOT NULL DEFAULT 60,
          days_offset INTEGER NOT NULL DEFAULT 0,
          last_run_at INTEGER,
          next_run_at INTEGER,
          created_at INTEGER,
          updated_at INTEGER
        )
      `);
      database.run('CREATE INDEX IF NOT EXISTS idx_st_ds_id ON schedule_tasks(data_source_id)');

      // 从旧 data_sources.schedule_* 字段迁移已有定时配置
      if (hasColumn(database, 'data_sources', 'schedule_enabled')) {
        const oldSchedules = database.exec(
          `SELECT id, schedule_instance_name, schedule_interval_minutes, schedule_days_offset, schedule_enabled, last_scheduled_at, next_scheduled_at
           FROM data_sources WHERE schedule_enabled = 1 AND schedule_instance_name IS NOT NULL AND schedule_instance_name != ''`
        );
        if (oldSchedules.length > 0) {
          const now = Date.now();
          for (const row of oldSchedules[0].values) {
            const dsId = row[0] as number;
            const instanceName = row[1] as string;
            const interval = row[2] as number;
            const daysOffset = row[3] as number;
            const lastRunAt = row[5] as number | null;
            const nextRunAt = row[6] as number | null;
            database.run(
              `INSERT INTO schedule_tasks (data_source_id, instance_name, enabled, interval_minutes, days_offset, last_run_at, next_run_at, created_at, updated_at)
               VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
              [dsId, instanceName, interval, daysOffset, lastRunAt, nextRunAt, now, now]
            );
          }
          console.log(`[DB Migration] 从 data_sources 迁移了 ${oldSchedules[0].values.length} 条定时配置`);
        }
      }

      migrated = true;
    }

    // 确保新结构的索引存在（无论是新建库还是迁移后的库）
    database.run('CREATE INDEX IF NOT EXISTS idx_sq_ds_inst_date ON slow_queries(data_source_id, instance_name, sync_date)');
    database.run('CREATE INDEX IF NOT EXISTS idx_sh_ds_date ON sync_history(data_source_id, sync_date)');

    // === 迁移 6: 统计分析覆盖索引 ===
    // 列构成与期望不一致时重建（用于升级早期版本建的窄索引）
    for (const { name, columns } of ANALYTICS_INDEXES) {
      const existing = indexColumns(database, name);
      if (existing.length > 0 && existing.join(',') === columns.join(',')) continue;

      const t0 = Date.now();
      if (existing.length > 0) {
        console.log(`[DB Migration] ${name} 列构成已变更，重建索引...`);
        database.run(`DROP INDEX ${name}`);
      } else {
        console.log(`[DB Migration] 建立统计分析覆盖索引 ${name}（大库首次执行需要数秒）...`);
      }
      database.run(`CREATE INDEX ${name} ON slow_queries(${columns.join(', ')})`);
      console.log(`[DB Migration] ${name} 就绪，耗时 ${Date.now() - t0}ms`);
      migrated = true;
    }

    // 清理会误导查询规划器的冗余单列索引
    for (const name of OBSOLETE_INDEXES) {
      if (hasIndex(database, name)) {
        console.log(`[DB Migration] 删除已被覆盖索引取代的 ${name}`);
        database.run(`DROP INDEX ${name}`);
        migrated = true;
      }
    }

    database.run('COMMIT');

    if (migrated) {
      console.log('[DB Migration] 所有迁移执行成功');
    }
  } catch (error) {
    database.run('ROLLBACK');
    console.error('[DB Migration] 迁移失败，已回滚:', error);
    throw error;
  }
}

/**
 * 获取数据库实例
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

/**
 * 持久化数据库（空实现，保留以兼容既有调用点）
 *
 * sql.js 时代整个库在内存里，必须显式 export 整库并覆盖写文件，
 * 这既是 Array buffer allocation failed 的根源，也让非正常退出会丢数据。
 * better-sqlite3 每个事务提交时就已经落盘，无需任何额外动作。
 *
 * 保留这个空函数是为了不改动 18 处调用点；新代码不应再调用它。
 */
export function saveDatabase(): void {
  /* better-sqlite3 写入即落盘，无需手动持久化 */
}

/**
 * 获取数据库占用的字节数
 * 用 PRAGMA 计算，不读取文件也不复制整库
 */
export function getDatabaseByteSize(): number {
  if (!db) return 0;
  const pageCount = db.exec('PRAGMA page_count');
  const pageSize = db.exec('PRAGMA page_size');
  if (pageCount.length === 0 || pageSize.length === 0) return 0;
  return (pageCount[0].values[0][0] as number) * (pageSize[0].values[0][0] as number);
}

/**
 * 回收数据库空闲页并压缩文件体积
 * 删除大量数据后文件不会自动收缩，需要显式 VACUUM
 * @returns 压缩前后的字节数
 */
export function vacuumDatabase(): { before: number; after: number } {
  if (!db) return { before: 0, after: 0 };
  const before = getDatabaseByteSize();
  db.run('VACUUM');
  return { before, after: getDatabaseByteSize() };
}

/**
 * 关闭数据库连接
 * 关闭前把 WAL 内容合并回主库文件，避免残留 -wal 文件
 */
export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.error('[DB] WAL checkpoint 失败:', (error as Error).message);
    }
    db.close();
    db = null;
    console.log('[DB] 数据库已关闭');
  }
}
