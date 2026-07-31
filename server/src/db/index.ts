import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

// 数据库文件路径（支持通过环境变量覆盖，用于 Electron 打包模式）
const DB_DIR = process.env.DB_DIR_OVERRIDE || path.resolve(__dirname, '../../data');
const DB_PATH = path.resolve(DB_DIR, 'slow_queries.db');

let db: Database | null = null;

/**
 * 初始化 SQLite 数据库
 * - 如果数据库文件存在则加载，否则创建新数据库
 * - 自动创建表和索引
 * - 执行迁移（为已有表补列、重建约束等）
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  // 确保数据目录存在
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // 加载或创建数据库
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 创建表结构（新表 + 已有表的 IF NOT EXISTS）
  createTables(db);

  // 执行迁移（为已有数据库补列、重建约束）
  runMigrations(db);

  // 持久化到文件
  saveDatabase();

  console.log('[DB] SQLite 数据库初始化完成:', DB_PATH);
  return db;
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

  database.run(`CREATE INDEX IF NOT EXISTS idx_fingerprint ON slow_queries(fingerprint)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON slow_queries(timestamp)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_db_name ON slow_queries(db_name)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_instance_name ON slow_queries(instance_name)`);
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

/**
 * 检查表中是否存在某列
 */
function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  if (result.length === 0) return false;
  return result[0].values.some((row) => row[1] === column);
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

    // 确保新结构的索引存在（无论是新建库还是迁移后的库）
    database.run('CREATE INDEX IF NOT EXISTS idx_sq_ds_inst_date ON slow_queries(data_source_id, instance_name, sync_date)');
    database.run('CREATE INDEX IF NOT EXISTS idx_sh_ds_date ON sync_history(data_source_id, sync_date)');

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
 * 将数据库持久化到磁盘
 */
export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('[DB] 数据库已关闭');
  }
}
