# Aegis backend. Runs migrations on start so a fresh Postgres works with one
# deploy. Node 24 matches CI.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# ---- deps -------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------
FROM deps AS build
COPY prisma ./prisma
COPY tsconfig*.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ---- runtime ----------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# demo-seed.ts and seed.ts are TypeScript; run them with tsx so a fresh
# database can be populated without a separate build step.
COPY prisma/seed.ts prisma/demo-seed.ts ./prisma/
COPY --from=build /app/node_modules/.bin/tsx ./node_modules/.bin/tsx

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]