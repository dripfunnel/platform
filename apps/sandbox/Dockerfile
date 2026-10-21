# The sandbox image for one storefront-core version (storefront AI-STUDIO §1): the studio's container on Cloudflare and
# the store repos' build image on ghcr.io. Built from the repo root by .github/workflows/release.yml.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter @dripfunnel/sandbox... \
 && pnpm --filter @dripfunnel/sandbox... run build \
 && pnpm --filter @dripfunnel/sandbox deploy --legacy --prod /out \
 && cp -r apps/sandbox/dist /out/dist

FROM node:22-slim
# Chromium is the publish check's browser (LIVE-SHOP §4 step 7); the studio never starts it.
RUN apt-get update && apt-get install -y --no-install-recommends git chromium && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /opt/sandbox
# No credential is ever set here or at start (the server refuses one); the container's internet is off.
ENV NODE_ENV=production PORT=8080 SANDBOX_SLOTS=1 SANDBOX_WORK=/tmp/sandbox SANDBOX_RUNTIME=/opt/sandbox/dist/runtime-files
USER node
EXPOSE 8080
CMD ["node", "/opt/sandbox/dist/main.js"]
