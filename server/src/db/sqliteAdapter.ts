/**
 * better-sqlite3 适配层
 *
 * 目的：用 better-sqlite3 提供与原 sql.js 完全一致的调用形状，
 * 使 services 层（statsService / fingerprintService / groupService /
 * dataSourceService / schedulerService / queries.ts）无需改动。
 *
 * 为什么从 sql.js 迁移：sql.js 是纯内存数据库，整个库常驻 JS 堆的 ArrayBuffer，
 * 且每次持久化都要 export 一份完整拷贝。库到 GB 级别后必然抛
 * Array buffer allocation failed。better-sqlite3 直接读写磁盘文件，
 * 内存占用与库体积无关。
 *
 * 必须保持的 sql.js 语义（services 层大量依赖）：
 * 1. exec() 查询无结果时返回外层空数组 []，而不是 [{ columns, values: [] }]。
 *    所有 `result.length === 0` 判空分支都建立在这个语义上。
 * 2. values 是 unknown[][] 二维数组，调用方按下标取值（row[0]、row[10] 等），
 *    因此必须用 raw 模式而非 better-sqlite3 默认的对象模式。
 * 3. columns 取 SQL 里 AS 别名后的名字，且与 values 各行的下标严格对齐。
 * 4. run() 需要能同时接受 DDL、事务控制语句和带参数的 DML。
 */

import BetterSqlite3 from 'better-sqlite3';

/** 与 sql.js 一致的查询结果形状 */
export interface QueryExecResult {
  columns: string[];
  values: unknown[][];
}

/** 与 sql.js 一致的预编译语句形状 */
export interface Statement {
  run(values?: unknown[]): void;
  free(): boolean;
}

/**
 * 归一化绑定参数
 *
 * better-sqlite3 的参数校验比 sql.js 严格得多，会直接抛错拒绝：
 * - undefined（sql.js 当作 null 处理）
 * - boolean（sql.js 会隐式转 0/1）
 * - 非整数的大数值等
 * 调用方的 params 类型是 unknown[]，历史代码里确实会传进 undefined 和布尔值，
 * 所以统一在这里转换，避免逐个调用点改造。
 */
function normalizeParams(params?: unknown[]): unknown[] {
  if (!params || params.length === 0) return [];
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/**
 * 数据库句柄，对外暴露 sql.js 风格的 API
 */
export class SqliteDatabase {
  private raw: BetterSqlite3.Database;

  /**
   * 预编译语句缓存
   *
   * better-sqlite3 每次 prepare 都要重新编译 SQL，而 isDateSynced 之类的函数
   * 会被高频调用。缓存后可省掉重复编译开销。
   * SQLite 在表结构变化时会让已编译语句返回 SQLITE_SCHEMA，better-sqlite3
   * 内部会自动重新编译，因此缓存对 DDL 是安全的；保险起见执行 DDL 时仍会清空。
   */
  private stmtCache = new Map<string, BetterSqlite3.Statement>();

  /** 缓存上限，超过后整体清空，避免动态拼接的 SQL 让缓存无限增长 */
  private static readonly STMT_CACHE_LIMIT = 200;

  constructor(filePath: string) {
    this.raw = new BetterSqlite3(filePath);
  }

  /** 取底层 better-sqlite3 实例，供需要原生能力的场景使用（如 pragma、backup） */
  get native(): BetterSqlite3.Database {
    return this.raw;
  }

  private getCachedStatement(sql: string): BetterSqlite3.Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      if (this.stmtCache.size >= SqliteDatabase.STMT_CACHE_LIMIT) {
        this.stmtCache.clear();
      }
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * 执行语句，不关心返回值
   * 无参数时走底层 exec（可处理 DDL、BEGIN/COMMIT/ROLLBACK、多条语句），
   * 带参数时走预编译语句
   */
  run(sql: string, params?: unknown[]): void {
    if (!params || params.length === 0) {
      // DDL 可能改变表结构，让缓存里的语句失效，直接清空更保险
      this.stmtCache.clear();
      this.raw.exec(sql);
      return;
    }
    const stmt = this.getCachedStatement(sql);
    const bound = normalizeParams(params) as never[];
    // better-sqlite3 在返回数据的语句上调 run() 会抛错，这里兜底丢弃结果
    if (stmt.reader) {
      stmt.raw(true).all(bound);
      return;
    }
    stmt.run(bound);
  }

  /**
   * 执行语句并返回 sql.js 形状的结果集
   * 非查询语句（INSERT/UPDATE/DELETE 等）执行后返回空数组
   */
  exec(sql: string, params?: unknown[]): QueryExecResult[] {
    const stmt = this.getCachedStatement(sql);
    const bound = normalizeParams(params) as never[];

    // reader 为 false 表示该语句不返回数据行
    if (!stmt.reader) {
      stmt.run(bound);
      return [];
    }

    // raw(true) 让每行以数组返回，与 sql.js 的 values 形状一致
    const values = stmt.raw(true).all(bound) as unknown[][];

    // 关键语义：无结果时返回外层空数组，与 sql.js 保持一致
    if (values.length === 0) return [];

    const columns = stmt.columns().map((c) => c.name);
    return [{ columns, values }];
  }

  /**
   * 创建预编译语句，用于批量写入时复用
   * free() 保留为兼容 sql.js 的空实现：better-sqlite3 的语句由 GC 回收
   */
  prepare(sql: string): Statement {
    const stmt = this.raw.prepare(sql);
    return {
      run(values?: unknown[]): void {
        stmt.run(normalizeParams(values) as never[]);
      },
      free(): boolean {
        return true;
      },
    };
  }

  /** 设置 PRAGMA，返回结果（如需） */
  pragma(statement: string): unknown {
    return this.raw.pragma(statement);
  }

  /** 导出整库为字节数组。注意会一次性分配与库等大的内存，大库上慎用 */
  export(): Uint8Array {
    return this.raw.serialize();
  }

  get open(): boolean {
    return this.raw.open;
  }

  close(): void {
    this.stmtCache.clear();
    this.raw.close();
  }
}
