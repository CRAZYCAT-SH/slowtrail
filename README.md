# SlowTrail — MySQL 慢 SQL 分析平台

从 Elasticsearch 拉取 MySQL 慢查询日志，存入本地 SQLite 进行多维度统计分析和可视化展示，帮助快速定位数据库性能瓶颈。

支持桌面应用（Electron）、Docker 容器、本地开发三种运行方式。

## 下载安装

### 桌面应用（推荐）

从 Release 页面下载对应平台安装包：

| 平台 | 格式 | 说明 |
|------|------|------|
| Windows | `.exe` | NSIS 安装包，无需管理员权限 |
| Windows | `.msi` | MSI 安装包，适合企业分发 |
| Windows | `.zip` | 免安装便携版，解压即用 |
| macOS | `.dmg` | 拖入 Applications 即可 |
| Linux | `.AppImage` | 免安装，赋予执行权限直接运行 |
| Linux | `.deb` | Debian/Ubuntu 安装包 |

桌面应用内置后端服务，双击打开即可使用，无需额外配置。

### Docker 部署

```bash
docker compose up -d
```

访问 http://localhost:3000

### 开发模式

```bash
npm install && cd server && npm install && cd ../client && npm install && cd ..
npm run dev
```

访问 http://localhost:5173

## 文档

- [数据源管理与数据同步操作指南](docs/datasource-guide.md) — 快速上手数据源配置和数据拉取

## 功能特性

### Dashboard 仪表盘

- 核心指标概览：总查询数、总耗时、平均/最大耗时、平均扫描行数、平均锁等待
- 环比对比：自动计算选定时间范围的上期数据，展示涨跌趋势
- 趋势对比图：本期与上期慢 SQL 数量对比
- 耗时分布直方图：按查询耗时区间统计分布
- 维度分布饼图：按数据库或实例维度查看慢 SQL 占比
- 7×24 热力图：按星期 × 小时聚合，发现周期性规律
- 高影响力 SQL TOP 10：按总耗时/频次/平均耗时排序

### 趋势分析

- 按分钟/小时/天切换聚合粒度
- 慢 SQL 数量趋势 + 平均/最大耗时趋势双图
- 支持按 SQL 指纹过滤单条趋势

### SQL 指纹归类

- 基于 SQL 指纹归类聚合，结构相同的 SQL 合并统计
- 支持按频次、平均耗时、最大耗时、平均扫描行数排序
- 展开详情：统计信息、耗时趋势图、原始 SQL 分页浏览
- SQL 格式化高亮展示

### 数据源管理

- 可插拔 Provider 架构，支持 Kibana 代理和直连 ES 两种方式
- 多数据源并行，数据合并统一分析
- 索引模板自定义，支持日/月/年/通配多种模式
- 字段映射自动发现

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS 4 + Recharts |
| 后端 | Node.js + Express + sql.js (SQLite) |
| 桌面 | Electron 33 + electron-builder |
| 容器 | Docker (多阶段构建) |

## 环境变量

配置文件为项目根目录 `.env`（仅首次启动时初始化默认数据源）：

```ini
ES_HOST=http://your-kibana-host:5601
ES_USERNAME=
ES_PASSWORD=
ES_PROXY_PATH=/api/console/proxy
ES_INDEX_PATTERN=mysql_slow_log-{YYYY}.{MM}.{DD}
PORT=3000
```

## 构建打包

### Electron 桌面应用

```bash
# 构建所有（后端 + 前端 + Electron）
npm run build:all

# 打包当前平台
npm run dist

# 指定平台
npm run dist:win
npm run dist:mac
npm run dist:linux
```

打包产物输出到 `release/` 目录。

### Docker 镜像

```bash
docker build -t slowtrail .
docker run -d -p 3000:3000 -v slowtrail-data:/app/server/data slowtrail
```

## 数据存储

| 运行模式 | 数据库位置 |
|---------|-----------|
| 桌面应用 | `%APPDATA%/slowtrail/` (Win) / `~/Library/Application Support/slowtrail/` (Mac) |
| Docker | 容器内 `/app/server/data/`，通过 volume 持久化 |
| 开发模式 | `server/data/slow_queries.db` |

## ES 索引要求

必需字段：

| 字段 | 说明 |
|------|------|
| `query_sql` | 完整 SQL 语句 |
| `query_time` | 查询耗时（秒） |
| `lock_time` | 锁等待时间（秒） |
| `rows_examined` | 扫描行数 |
| `rows_sent` | 返回行数 |
| `db_name` | 数据库名 |
| `instance_name` | 实例名 |
| `timestamp` | 时间戳 |

可选字段：`instance_id`、`node_id`、`user_name`、`user_host`

字段名可通过数据源的字段映射功能自定义。

## 常见问题

**Q: 桌面应用数据在哪？**

Windows: `C:\Users\{用户名}\AppData\Roaming\slowtrail\slow_queries.db`  
卸载应用不会删除数据，重装后数据保留。

**Q: ES 连接失败？**

Kibana 代理模式下请确保 `ES_HOST` 填的是 Kibana 地址（非 ES），且用户有对应索引读取权限。直连 ES 模式填写 ES 地址即可。

**Q: 端口被占用？**

桌面应用每次启动会自动分配可用端口，不存在端口冲突。Docker/开发模式默认使用 3000 端口，可通过 `PORT` 环境变量修改。

## License

MIT
