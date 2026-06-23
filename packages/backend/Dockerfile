FROM node:22-alpine
WORKDIR /app

RUN npm install -g pnpm tsx

# Manifiestos primero → mejor cache de capas
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile --prod

# Código fuente (después de deps para que el cache no se invalide en cada cambio de código)
COPY shared/src ./shared/src
COPY packages/backend/src ./packages/backend/src

EXPOSE 3001
CMD ["tsx", "packages/backend/src/index.ts"]
