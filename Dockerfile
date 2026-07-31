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
# 阶段 2：构建后端
# ============================================
FROM node:20-alpine AS server-builder

WORKDIR /app/server

# 先复制依赖清单
COPY server/package.json server/package-lock.json ./
RUN npm ci

# 复制后端源码并编译 TypeScript
COPY server/ ./
RUN npm run build

# ============================================
# 阶段 3：生产运行镜像
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# 仅安装后端生产依赖
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

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
VOLUME ["/app/server/data"]

# 启动服务
CMD ["node", "server/dist/index.js"]
