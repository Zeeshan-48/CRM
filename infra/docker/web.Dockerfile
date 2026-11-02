# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# The CRM workspace app (apps/web): a Vite single-page app, built once and
# served as static files by an unprivileged nginx on port 8080.
#
#   docker build -f infra/docker/web.Dockerfile -t open-crm-web \
#     --build-arg VITE_API_BASE_URL=http://localhost:5066/api/v1 .
#
# VITE_API_BASE_URL is compiled into the bundle, so the image is built per deployment.
# On AWS the same build goes to S3 behind CloudFront instead of this image:
# scripts/aws-deploy.sh exports the static files with --target dist and uploads them.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22.23.4-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29.3-alpine

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# package.json too: it pins the pnpm version (packageManager) and carries the overrides
# the frozen lockfile is checked against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @open-crm/web...
ARG VITE_API_BASE_URL=http://localhost:5066/api/v1
# WhatsApp Embedded Signup (optional; the Connect button hides without them).
ARG VITE_META_APP_ID=""
ARG VITE_META_WA_ES_CONFIG_ID=""
ARG VITE_META_GRAPH_API_VERSION=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_META_APP_ID=${VITE_META_APP_ID} \
    VITE_META_WA_ES_CONFIG_ID=${VITE_META_WA_ES_CONFIG_ID} \
    VITE_META_GRAPH_API_VERSION=${VITE_META_GRAPH_API_VERSION}
RUN pnpm --filter @open-crm/web build

# Just the built files: docker buildx build --target dist --output type=local,dest=<dir>
FROM scratch AS dist
COPY --from=build /repo/apps/web/dist /

FROM ${NGINX_IMAGE} AS runtime
COPY infra/docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY infra/docker/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
