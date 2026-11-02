# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# API image (apps/api). One image, three commands:
#
#   node dist/index.js                        HTTP on PORT (default 5066): /api/v1, /up,
#                                             /api/health. A node cluster; one cluster
#                                             worker also runs the background jobs.
#   node db/migrate.js [--status]             forward-only SQL migrations (one-off task)
#   node dist-scripts/scripts/seed.js         demo data (make demo; --force wipes first)
#
#   docker build -f infra/docker/api.Dockerfile -t open-crm-api .
#
# The API is compiled with tsc (pnpm --filter @open-crm/api build). The seed and its
# imports are compiled with the API's scripts tsconfig into dist-scripts/, and
# db/migrate.ts is transpiled to db/migrate.js, so the runtime needs no TypeScript
# toolchain. Production dependencies only, from `pnpm deploy --prod`.
#
# The RDS certificate bundle is baked in: with NODE_EXTRA_CA_CERTS pointing at it and
# PGSSLMODE=verify-full (set by the Terraform task definitions), the pg driver verifies
# the database certificate and host name.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Download every package in the lockfile first: this layer only changes with the lockfile.
# package.json too: it pins the pnpm version (packageManager) and carries the overrides
# the frozen lockfile is checked against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @open-crm/api...
RUN pnpm --filter @open-crm/api build
# The seed (and the src modules it imports) as plain JavaScript.
RUN cd apps/api && node_modules/.bin/tsc -p tsconfig.scripts.json --noEmit false --outDir dist-scripts --sourceMap false
# db/migrate.ts as CommonJS, next to the migrations it applies.
RUN mkdir -p /out/db && cp -r db/migrations /out/db/migrations && node -e " \
  const ts = require('/repo/apps/api/node_modules/typescript'); \
  const fs = require('fs'); \
  const out = ts.transpileModule(fs.readFileSync('db/migrate.ts', 'utf8'), { compilerOptions: { \
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }); \
  fs.writeFileSync('/out/db/migrate.js', out.outputText);"
# Production dependencies of the API only, as a self-contained node_modules.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @open-crm/api deploy --prod /out/app

FROM ${NODE_IMAGE} AS runtime
# LOCAL_STORAGE_DIR only matters when AWS_S3_BUCKET is blank (local disk storage).
# Compose mounts a volume there; ECS (read-only root filesystem) points it at /tmp.
ENV NODE_ENV=production TZ=UTC PORT=5066 \
    MIGRATIONS_DIR=/app/db/migrations LOCAL_STORAGE_DIR=/app/.local-storage
WORKDIR /app
# tini reaps zombies and forwards SIGTERM so the cluster drains and the jobs stop cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/.local-storage /app/certs && chown node:node /app/.local-storage
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
COPY --from=build --chown=node:node /out/app/package.json ./package.json
COPY --from=build --chown=node:node /out/app/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/dist-scripts ./dist-scripts
COPY --from=build --chown=node:node /out/db ./db
USER node
EXPOSE 5066
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5066)+'/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
