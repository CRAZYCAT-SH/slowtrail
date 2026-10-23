# ============================================
# 阶段 1：构建前端
# ============================================
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# 先复制依赖清单，利用 Docker 缓存
COPY client/package.json client/package-lock.json ./
RUN npm ci

# 复制前端源码并构建
COPY client/ ./
RUN npm run build

# ============================================
# 阶段 2：构建后端（含原生模块 better-sqlite3）
# ============================================
FROM node:20-alpine AS server-builder

WORKDIR /app/server

# better-sqlite3 是原生模块。官方为 alpine（musl）提供了预编译二进制，
# 正常情况下 prebuild-install 会直接下载；这里仍装上工具链，
# 以便下载失败时能回退到 node-gyp 源码编译。
# 这些工具只存在于构建阶段，不会进入最终镜像。
RUN apk add --no-cache python3 make g++

# 先复制依赖清单
COPY server/package.json server/package-lock.json ./
RUN npm ci

# 复制后端源码并编译 TypeScript
COPY server/ ./
RUN npm run build

# 剔除开发依赖，保留已就位的原生二进制，供生产阶段直接复用
# （生产阶段不再 npm ci，避免重复下载/编译原生模块）
RUN npm prune --omit=dev \
    && rm -rf node_modules/better-sqlite3/deps \
              node_modules/better-sqlite3/src \
    && node -e "require('better-sqlite3'); console.log('[build] better-sqlite3 原生模块加载正常')"

# ============================================
# 阶段 3：生产运行镜像
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# 直接复用阶段 2 已安装好的生产依赖（含编译就绪的 better_sqlite3.node）
COPY --from=server-builder /app/server/node_modules ./server/node_modules
COPY --from=server-builder /app/server/package.json ./server/package.json

# 复制后端编译产物
COPY --from=server-builder /app/server/dist ./server/dist

# 复制前端构建产物
COPY --from=client-builder /app/client/dist ./client/dist

# 创建数据目录（SQLite 持久化用）
RUN mkdir -p /app/server/data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 数据卷：持久化 SQLite 数据库文件
# 注意：数据库启用了 WAL 模式，同目录会额外产生 .db-wal / .db-shm 文件。
# 该目录需挂载在支持文件锁与共享内存的本地卷上，不要用 NFS 等网络文件系统。
VOLUME ["/app/server/data"]

# 启动服务（作为 PID 1 直接接收 SIGTERM，触发优雅关库与 WAL checkpoint）
CMD ["node", "server/dist/index.js"]
