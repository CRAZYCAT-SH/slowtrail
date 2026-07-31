# AGENTS.md

## 项目概述

慢 SQL 分析工具 — 从可配置的数据源（ES 等）拉取 MySQL 慢查询日志，存入本地 SQLite 数据库进行统计分析和可视化展示。支持多数据源并行使用，数据合并统一分析。

## 技术栈

- **后端**：Node.js + TypeScript + Express + sql.js（SQLite）+ axios + sql-fingerprint + xlsx + multer
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS 4 + React Router 7 + Recharts 3 + Axios
- **开发工具**：tsx（开发模式）、concurrently（前后端并行启动）、ESLint
- **桌面打包**：Electron 33 + electron-builder（支持 Windows/macOS/Linux 安装包）
- **容器部署**：Docker（多阶段构建）
- **数据存储**：sql.js（内存数据库 + 文件持久化），数据文件位于 `server/data/slow_queries.db`

## 项目结构

```
slow-sql-checker/
├── package.json              # 根项目（concurrently 并行启动前后端）
├── .env / .env.example       # 环境变量配置（默认数据源初始化用）
├── Dockerfile                # 多阶段构建（前端构建 + 后端编译 + 精简运行镜像）
├── .dockerignore             # Docker 构建排除文件
├── docker-compose.yml        # Docker Compose 快速启动配置
├── electron-builder.config.js # Electron 打包配置（多平台）
├── electron/                 # Electron 主进程
│   ├── main.ts               # 主进程（启动后端 + 创建窗口 + 系统托盘）
│   ├── preload.ts            # 预加载脚本（contextBridge）
│   └── tsconfig.json         # Electron TypeScript 配置
├── scripts/                  # 辅助脚本
│   └── wait-then-electron.js # 等待服务就绪后启动 Electron
├── build/                    # 打包资源（图标文件）
├── server/                   # 后端服务
│   ├── src/
│   │   ├── index.ts          # Express 入口，注册路由和中间件
│   │   ├── db/
│   │   │   ├── index.ts      # SQLite 数据库初始化、表结构、迁移、持久化
│   │   │   └── queries.ts    # 数据库操作（批量插入、同步记录、统计）
│   │   ├── providers/        # 数据源 Provider 可插拔架构
│   │   │   ├── types.ts      # Provider 契约、共享类型、默认值
│   │   │   ├── index.ts      # Provider 注册表（getProvider / listProviders）
│   │   │   ├── indexResolver.ts    # 索引模板解析（推断周期、渲染、通配）
│   │   │   ├── esQueryBuilder.ts   # ES 查询构造（range + term + search_after）
│   │   │   ├── esNormalizer.ts     # ES 文档归一化为 NormalizedSlowQuery
│   │   │   ├── esFieldDiscovery.ts # ES 索引字段发现（_mapping 解析）
│   │   │   ├── kibanaProxyProvider.ts  # Kibana 代理方式访问 ES
│   │   │   ├── directESProvider.ts     # 直连 ES REST API
│   │   │   └── excelProvider.ts        # Excel/CSV 文件导入
│   │   ├── services/
│   │   │   ├── dataSourceService.ts # 数据源 CRUD + 环境变量导入 + 密码脱敏
│   │   │   ├── syncService.ts       # 数据同步（Provider → 逐批入库 + 指纹计算）
│   │   │   ├── statsService.ts      # 统计分析（概览、TOP N、趋势、分布、热力图）
│   │   │   ├── fingerprintService.ts # SQL 指纹归类分析
│   │   │   └── groupService.ts      # 指纹归类管理（CRUD、相似推荐算法）
│   │   ├── routes/
│   │   │   ├── dataSourceRoutes.ts  # /api/datasources/*
│   │   │   ├── syncRoutes.ts        # /api/sync/*
│   │   │   ├── statsRoutes.ts       # /api/stats/*
│   │   │   ├── fingerprintRoutes.ts # /api/fingerprints/*
│   │   │   └── groupRoutes.ts       # /api/fingerprint-groups/*
│   │   └── types/            # 类型声明文件
│   ├── data/                 # SQLite 数据库文件
│   ├── tsconfig.json         # TypeScript 配置（ES2020, strict）
│   └── package.json
└── client/                   # 前端应用
    ├── src/
    │   ├── main.tsx          # React 入口
    │   ├── App.tsx           # 路由定义（/, /trends, /fingerprints, /sync）
    │   ├── api/index.ts      # API 客户端封装（axios，带完整类型定义）
    │   ├── hooks/            # 自定义 hooks
    │   │   └── useQueryParams.ts   # URL 查询参数双向绑定 hook
    │   ├── components/       # 通用组件
    │   │   ├── Layout.tsx          # 顶部导航栏布局（含全局时间选择器）
    │   │   ├── DateRangeShortcuts.tsx # 时间范围快捷选择组件
    │   │   ├── HeatmapChart.tsx    # 7×24 热力图组件
    │   │   ├── SQLBlock.tsx        # SQL 高亮 + 格式化展示组件
    │   │   └── datasource/         # 数据源管理组件
    │   │       ├── formRegistry.ts       # type → 表单组件注册表
    │   │       ├── EsCommonFields.tsx    # ES 类共用字段（认证/索引模板/预览/字段映射）
    │   │       ├── KibanaProxyForm.tsx   # Kibana 代理表单
    │   │       ├── DirectESForm.tsx      # 直连 ES 表单
    │   │       ├── ExcelForm.tsx         # Excel/CSV 导入表单（文件上传+列映射）
    │   │       ├── DataSourceModal.tsx   # 新增/编辑弹窗
    │   │       ├── DataSourceList.tsx    # 数据源列表（测试/编辑/删除）
    │   │       └── index.ts              # 导出
    │   └── pages/            # 页面组件
    │       ├── DashboardPage.tsx    # 首页仪表盘
    │       ├── TrendsPage.tsx       # 趋势分析
    │       ├── FingerprintsPage.tsx # SQL 指纹归类
    │       └── SyncPage.tsx         # 数据源管理 + 数据同步
    ├── vite.config.ts        # Vite 配置（含 /api 代理到 localhost:3000）
    └── package.json
```

## 开发命令

```bash
# 安装依赖（根目录 + server + client）
npm install
cd server && npm install
cd ../client && npm install

# 同时启动前后端开发服务器
npm run dev

# 仅启动后端（tsx watch 模式，端口 3000）
npm run dev:server

# 仅启动前端（Vite，端口 5173，/api 代理到后端）
npm run dev:client

# 后端构建
cd server && npm run build

# 前端构建
cd client && npm run build

# 前端 lint
cd client && npm run lint
```

## Electron 桌面应用

```bash
# 开发模式（同时启动前后端 + Electron 窗口）
npm run dev:electron

# 构建所有（后端编译 + 前端构建 + Electron 主进程编译）
npm run build:all

# 打包为安装包（当前平台）
npm run dist

# 指定平台打包
npm run dist:win      # Windows（.exe 安装器）
npm run dist:mac      # macOS（.dmg）
npm run dist:linux    # Linux（.AppImage + .deb）

# 仅打包（不生成安装器，用于调试）
npm run pack
```

**Electron 架构说明**：
- 主进程通过 `spawn()` 启动 Express 后端作为子进程（使用随机可用端口）
- 窗口加载 `http://localhost:<port>`（生产模式）或 `http://localhost:5173`（开发模式）
- 关闭窗口时最小化到系统托盘，托盘右键菜单可完全退出
- 托盘左键单击恢复窗口，右键弹出菜单（显示主窗口 / 在浏览器中打开 / 退出）
- 单实例锁：防止用户启动多个实例
- 数据库文件存储在用户数据目录（`app.getPath('userData')`），通过 `DB_DIR_OVERRIDE` 环境变量传递给后端
- 打包资源图标放置在 `build/` 目录（ico/icns/png 格式）
- 托盘图标：Windows 优先使用 `build/icon.ico`，其他平台使用 `build/icon.png`；开发模式路径从 `electron/dist/` 回溯两级到项目根

**打包注意事项**：
- 打包前务必关闭已运行的 SlowTrail 进程，否则 electron-builder 无法覆盖 `release/win-unpacked/SlowTrail.exe`（报 EBUSY 错误）
- Windows 打包命令：`npm run dist:win`（内含 build:all + electron-builder --win）
- 打包产物输出到 `release/` 目录：`.exe`（NSIS 安装器）、`.zip`（绿色版）、`.msi`
- 如遇 `__msi-x64` 目录锁定问题，手动删除 `release/__msi-x64` 后重试
- `build/` 目录需包含 `icon.png`（通用）和 `icon.ico`（Windows 托盘/安装器图标）

## Docker 部署

```bash
# 构建镜像
docker build -t slowtrail .

# 运行容器（数据持久化到命名卷）
docker run -d --name slowtrail \
  -p 3000:3000 \
  -v slowtrail-data:/app/server/data \
  -e ES_HOST=http://your-kibana-host:5601 \
  -e ES_USERNAME=user \
  -e ES_PASSWORD=pass \
  slowtrail

# 或使用 docker-compose（推荐）
docker compose up -d

# 查看日志
docker compose logs -f

# 停止并清理
docker compose down

# 停止并删除数据卷（清空所有数据）
docker compose down -v
```

**镜像说明**：
- 基础镜像 `node:20-alpine`，生产镜像约 ~120MB
- 多阶段构建：阶段 1 构建前端、阶段 2 编译后端 TypeScript、阶段 3 仅含运行时依赖
- `NODE_ENV=production` 时后端自动托管前端静态资源，单端口 3000 提供完整服务
- 数据卷 `/app/server/data` 持久化 SQLite 数据库文件
- 环境变量通过 `-e` 或 `docker-compose.yml` 的 `environment` 传入

## 环境变量

配置文件为项目根目录的 `.env`，后端通过 `dotenv` 加载。这些变量**仅用于首次启动时初始化默认数据源**，之后以数据库中的配置为准：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ES_HOST` | Kibana/ES 地址 | `http://localhost:5601` |
| `ES_USERNAME` | 认证用户名 | 空 |
| `ES_PASSWORD` | 认证密码 | 空 |
| `ES_PROXY_PATH` | Kibana 代理路径 | `/api/console/proxy` |
| `ES_INDEX_PATTERN` | 索引命名模板 | `mysql_slow_log-{YYYY}.{MM}.{DD}` |
| `PORT` | 后端服务端口 | `3000` |

## 架构约定

### 数据源 Provider 可插拔

系统采用 Provider 架构实现数据源解耦：

- **基契约**（`DataSourceProvider`）：所有数据源类型都实现 `testConnection` / `fetchRecords` 等方法
- **归一化由 Provider 负责**：`syncService` 只认 `NormalizedSlowQuery`，不感知原始数据形态
- **`fetchRecords` 返回 `AsyncIterable<FetchBatch>`**：分批产出，不会一次性把大量数据载入内存
- **可选能力接口**：`InstanceEnumerable`（枚举实例列表）、`ConfigPreviewable`（预览配置）、`FieldDiscoverable`（索引字段发现），按 `capabilities()` 声明
- **配置存 SQLite**：`data_sources` 表，类型专属配置存 `settings` JSON 字段
- **密码脱敏**：API 对外返回时密钥字段替换为 `******`，更新时收到 `******` 保留原值

**后端新增数据源类型三步**：
1. 实现 `DataSourceProvider` 接口（按需实现可选能力接口）
2. 在 `providers/index.ts` 注册表加一行
3. 完成。`syncService`、`dataSourceService`、路由层均无需改动

**前端新增数据源类型两步**：
1. 创建对应的表单组件（如 `MySqlTableForm.tsx`）
2. 在 `formRegistry.ts` 加一行映射

### Excel/CSV 数据源

系统支持从 Excel/CSV 文件导入慢查询数据，作为正式的 Provider 类型（`excel`）接入：

- **文件上传**：通过 `POST /api/datasources/upload`（multer）接收文件，存储在 `server/data/uploads/`
- **列映射**：用户上传后前端展示表头，配置哪列对应 `querySql`、`queryTime` 等标准字段
- **同步流程**：和 ES 数据源一致，走 syncService 标准去重逻辑
- **settings 结构**：`{ filePath, originalFileName, sheetName?, columnMapping: { querySql, queryTime, timestamp?, dbName?, ... } }`
- **capabilities**：不支持 instanceEnumeration 和 configPreview
- **时间戳解析**：支持毫秒/秒时间戳、日期字符串，无时间戳列时使用同步请求的 startTime

### 数据获取核心设计

- **由 timestamp range query 驱动**：索引模板仅决定搜索范围（搜哪些索引），数据时间边界来自 ES range filter，与索引物理布局解耦
- **索引模板完全由用户自定义**：占位符 `{YYYY}` `{YY}` `{MM}` `{M}` `{DD}` `{D}`，其余字符原样保留，可含 `*` 并与占位符混用
- **切分周期由占位符推断**：含日 → daily，含月 → monthly，仅年 → yearly，无占位符 → none（静态目标或纯通配）
- **索引集合向外扩一个周期**：索引日期后缀通常按 UTC 生成，与本地日界线可能错位，多搜无害、漏搜丢数据
- **搜索带 `ignore_unavailable=true&allow_no_indices=true`**：缺失索引返回空而非报错
- **同步日界线使用服务器本地时区**：固化到 `sync_date` 字段

### 同步去重

去重键为「数据源 + 实例 + 日期」（`UNIQUE(data_source_id, instance_name, sync_date)`），索引名降级为 `source_ref` 诊断字段。删除操作按三元组精确匹配。

### 后端通用约定

- **分层架构**：routes → services → providers/db
- **生产模式**：`NODE_ENV=production` 时后端托管 `client/dist` 静态资源，支持 SPA 路由 fallback，单端口提供前后端服务
- **数据库**：sql.js（WebAssembly 版 SQLite），内存运行 + 手动持久化到文件
- **数据库迁移**：`runMigrations()` 在 `initDatabase()` 后执行，用 `PRAGMA table_info` 检测缺列后 `ALTER TABLE ADD COLUMN`，对 `sync_history` 做表重建以更新唯一约束
- **时间处理**：全链路使用毫秒时间戳（number 类型）
- **API 响应格式**：统一返回 `{ success: boolean, data?: T, error?: string }`
- **错误处理**：try-catch + 统一格式返回，错误日志输出到控制台
- **SQL 指纹**：使用 `sql-fingerprint` 库计算 SQL 指纹，用于聚合分析

### 前端

- **布局**：顶部水平导航栏（sticky header），左 Logo + 中间导航链接 + 右侧全局时间范围选择器；内容区 max-width 1440px 居中
- **路由**：React Router v7，BrowserRouter 模式
- **状态管理**：组件内状态（useState），无全局状态库；部分页面使用 `useQueryParams` hook 将筛选状态同步到 URL
- **API 调用**：axios 实例封装，带完整 TypeScript 类型
- **时间处理**：前端统一使用毫秒时间戳。`DateRangeShortcuts` 组件在 `mode="datetime"` 模式下输入输出为 `number`，`mode="date"` 模式输入输出为 `YYYY-MM-DD` 字符串
- **数据源管理**：前端按类型定制表单，通过 `formRegistry.ts` 注册表扩展，实例输入按 `capabilities.instanceEnumeration` 自动降级为文本框
- **图表**：Recharts 库进行数据可视化
- **SQL 展示**：`sql-formatter` + `react-syntax-highlighter`，封装为 `SQLBlock`
- **样式**：Tailwind CSS 4（`@tailwindcss/vite` 插件），全部 utility classes

### 编码规范

- TypeScript strict 模式
- 中文注释，英文标识符
- 接口和类型使用 `export interface` 导出
- 服务函数使用具名导出（非 default export），路由文件使用 `export default router`
- 错误类型统一用 `error as Error` 断言

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/datasources/types` | GET | 可用数据源类型列表（type/label/capabilities/defaultSettings） |
| `/api/datasources` | GET | 数据源列表（settings 密码脱敏 + summary + capabilities） |
| `/api/datasources` | POST | 新增数据源（body: name, type, settings, enabled?） |
| `/api/datasources/:id` | PUT | 修改数据源 |
| `/api/datasources/:id` | DELETE | 删除数据源（query: deleteData=true\|false；is_default 不可删） |
| `/api/datasources/:id/test` | POST | 测试已保存数据源连接 |
| `/api/datasources/test-unsaved` | POST | 测试未保存配置连接（body: type, settings） |
| `/api/datasources/:id/instance-names` | GET | 获取数据源实例列表（仅 instanceEnumeration 为真） |
| `/api/datasources/preview` | POST | 索引配置预览（body: type, settings, startDate, endDate） |
| `/api/datasources/fields` | POST | 获取索引字段列表（body: type, settings），用于字段映射下拉选择 |
| `/api/datasources/upload` | POST | 上传 Excel/CSV 文件（multipart/form-data），返回文件路径和表头 |
| `/api/datasources/upload/headers` | POST | 获取已上传文件指定 sheet 的表头（body: filePath, sheetName） |
| `/api/sync` | POST | 触发数据同步（body: dataSourceId?, instanceName, startDate, endDate, forceOverwrite?） |
| `/api/sync/history` | GET | 同步历史（query: instanceName?, dataSourceId?） |
| `/api/sync/last-instance` | GET | 最后同步的实例名 |
| `/api/sync/stats` | GET | 本地数据库统计 |
| `/api/sync/data` | DELETE | 清空本地数据（query: startTime?, endTime?） |
| `/api/sync/record` | DELETE | 按同步记录删除（query: dataSourceId, instanceName, syncDate） |
| `/api/stats/overview` | GET | 统计概览（query: startTime, endTime, dbName, instanceName, compareStartTime, compareEndTime） |
| `/api/stats/top-queries` | GET | TOP N 慢查询（额外 query: limit, offset, sortBy） |
| `/api/stats/trends` | GET | 趋势数据（额外 query: granularity, fingerprint, tzOffset） |
| `/api/stats/distribution` | GET | 分布统计 |
| `/api/stats/heatmap` | GET | 7×24 热力图数据（额外 query: tzOffset） |
| `/api/stats/filter-options` | GET | 筛选选项（dbNames, instanceNames） |
| `/api/fingerprints` | GET | SQL 指纹归类列表 |
| `/api/fingerprints/detail` | GET | 指纹详情 |
| `/api/fingerprint-groups` | GET | 所有指纹分类列表 |
| `/api/fingerprint-groups` | POST | 创建指纹分类 |
| `/api/fingerprint-groups/similar` | GET | 相似指纹推荐 |
| `/api/fingerprint-groups/:id` | PUT | 修改分类名称 |
| `/api/fingerprint-groups/:id` | DELETE | 删除分类 |
| `/api/fingerprint-groups/:id/fingerprints` | POST | 向分类添加指纹 |
| `/api/fingerprint-groups/:id/fingerprints/:fingerprint` | DELETE | 从分类移除指纹 |

## 数据库 Schema

### data_sources 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL | 数据源名称 |
| type | TEXT NOT NULL | Provider 类型标识（如 'kibana_proxy', 'direct_es'） |
| settings | TEXT NOT NULL | JSON，类型专属配置（由对应 provider 解释） |
| enabled | INTEGER | 是否启用 |
| is_default | INTEGER | 是否为环境变量导入的默认数据源 |
| created_at | INTEGER | 创建时间（毫秒时间戳） |
| updated_at | INTEGER | 更新时间 |

### slow_queries 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| query_sql | TEXT | 原始 SQL |
| fingerprint | TEXT | SQL 指纹 |
| query_time | REAL | 查询耗时（秒） |
| lock_time | REAL | 锁等待时间 |
| rows_examined | INTEGER | 扫描行数 |
| rows_sent | INTEGER | 返回行数 |
| db_name | TEXT | 数据库名 |
| instance_name | TEXT | 实例名 |
| instance_id | TEXT | 实例 ID |
| node_id | TEXT | 节点 ID |
| user_name | TEXT | 用户名 |
| user_host | TEXT | 用户主机 |
| timestamp | INTEGER | 毫秒时间戳 |
| es_index | TEXT | 来源索引名（诊断用） |
| data_source_id | INTEGER | 数据源 ID |
| sync_date | TEXT | 同步数据日期 YYYY-MM-DD |

索引：fingerprint, timestamp, db_name, instance_name, (data_source_id, instance_name, sync_date)

### sync_history 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| data_source_id | INTEGER | 数据源 ID |
| instance_name | TEXT | 实例名 |
| sync_date | TEXT | 数据日期 YYYY-MM-DD |
| source_ref | TEXT | 实际数据来源标识（如索引目标），仅诊断用 |
| synced_at | INTEGER | 同步时间（毫秒时间戳） |
| record_count | INTEGER | 同步记录数 |

唯一约束：(data_source_id, instance_name, sync_date)
索引：(data_source_id, sync_date)

### fingerprint_groups 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL | 分类名称 |
| created_at | INTEGER | 创建时间（毫秒时间戳） |

### fingerprint_group_members 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| group_id | INTEGER | 关联 fingerprint_groups.id |
| fingerprint | TEXT | SQL 指纹值 |

唯一约束：(fingerprint)
索引：group_id, fingerprint

## 注意事项

- **文档同步要求**：所有变更如果涉及架构约定更新、功能变动、API 变更、数据库 Schema 修改、新增/删除模块等，必须同步更新本文档（AGENTS.md）
- **Schema 迁移机制**：`db/index.ts` 中的 `runMigrations()` 会在启动时检测已有数据库并自动补列/重建表。对已有真实数据的库进行 Schema 变更时需通过此机制处理，不能依赖 `CREATE TABLE IF NOT EXISTS` 补列
- **密码明文存储**：数据源密码以明文存储在 SQLite 中（本地分析工具，可接受），但 API 对外返回时会脱敏
- 本项目无测试框架和测试文件，如需添加测试请先确认测试方案
- 支持 Electron 桌面打包（Windows/macOS/Linux 安装包），打包前需在 `build/` 目录放置对应平台图标
- 支持 Docker 部署，Dockerfile 采用多阶段构建，docker-compose.yml 提供快速启动方案
- Electron 打包产物输出到 `release/` 目录（已加入 .gitignore）
- sql.js 数据库文件 `server/data/slow_queries.db` 不应提交到版本库（已在 .gitkeep 中保留目录）
