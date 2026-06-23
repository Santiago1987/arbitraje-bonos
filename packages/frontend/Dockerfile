FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

# Manifiestos primero → mejor cache de capas
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/ ./shared/
COPY packages/frontend/package.json packages/frontend/tsconfig.json ./packages/frontend/

RUN pnpm install --frozen-lockfile

# Resto del código fuente del frontend
COPY packages/frontend/ ./packages/frontend/

RUN pnpm --filter frontend build

FROM nginx:alpine
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
EXPOSE 80

