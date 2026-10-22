# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# (Dependabot doesn't track the syntax line; bump it by hand alongside the base images.)

# Build from the repo root: docker build -f apps/web/Dockerfile .
# Targets: `web` (default, the Next.js server) and `migrate` (applies @repo/db migrations, then exits).
#
# Every base image is pinned by digest; the tag is only a hint for Dependabot, which bumps both.
# Remote cache (optional): --build-arg TURBO_TEAM=<team> --secret id=turbo_token,env=TURBO_TOKEN

# --- base: Node LTS + pnpm (version from the root package.json's `packageManager`)
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable

# --- prune: the slice of the monorepo that `web` needs, split into manifests and sources
FROM base AS prune
# turbo at the exact version in the root package.json, verified against the sha512 committed in
# pnpm-lock.yaml (not a checksum fetched from the same place as the binary). Only the binary is
# extracted from the tarball.
COPY package.json pnpm-lock.yaml apps/web/docker/fetch-turbo.mjs ./
RUN set -eu; \
    node fetch-turbo.mjs /tmp/turbo.tgz; \
    mkdir /tmp/turbo; \
    tar -xzf /tmp/turbo.tgz -C /tmp/turbo --strip-components=2 --wildcards '*/bin/turbo'; \
    install -m 755 /tmp/turbo/turbo /usr/local/bin/turbo; \
    rm -rf /tmp/turbo.tgz /tmp/turbo fetch-turbo.mjs
COPY . .
RUN turbo prune web --docker

# --- deps: installs only when a manifest or the pruned lockfile changes
FROM base AS deps
COPY --from=prune /app/out/json/ .
COPY --from=prune /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# --- build: the Next.js standalone server
FROM deps AS build
COPY --from=prune /app/out/full/ .
ARG TURBO_TEAM
ENV TURBO_TEAM=${TURBO_TEAM}
# The token is mounted for this step only, so it never lands in a layer or the image history.
RUN --mount=type=cache,id=turbo-cache,target=/app/.turbo/cache \
    --mount=type=cache,id=next-cache,target=/app/apps/web/.next/cache \
    --mount=type=secret,id=turbo_token,env=TURBO_TOKEN \
    pnpm exec turbo run build --filter=web \
    && mkdir -p /out/next-cache

# --- db-deploy: @repo/db with production dependencies only, for the migrate image
FROM deps AS db-deploy
COPY --from=prune /app/out/full/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @repo/db deploy --prod --legacy --store-dir /pnpm/store /out/db

# --- migrate: one-shot job, connects as the DDL-owning `migrator` role
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:78f07ef1b5ea71ad7c055df15d0dd8997f2d288f9158623c4d4ae3d765b7d50d AS migrate
WORKDIR /app
ENV NODE_ENV=production
# Owned by root and read-only to the `nonroot` (65532) user that runs it.
COPY --from=db-deploy /out/db ./
USER nonroot
CMD ["src/migrate.ts"]

# --- web: distroless (no shell or package manager), non-root, code not writable by the process
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:78f07ef1b5ea71ad7c055df15d0dd8997f2d288f9158623c4d4ae3d765b7d50d AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# The only path the server writes to (image optimization and ISR cache).
COPY --from=build --chown=nonroot:nonroot /out/next-cache ./apps/web/.next/cache
USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["apps/web/server.js"]
