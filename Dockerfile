# syntax=docker/dockerfile:1.7
#
# Next.js frontend.
#
# Multi-stage: dependencies, build, then a runtime stage that carries only the
# standalone output. The final image contains no package manager, no build
# toolchain and no source — a smaller attack surface and a faster cold start,
# which matters because Container Apps may start a replica while a user waits.
#
# Runs as an unprivileged user. The `node` user already exists in the base
# image with uid 1000.

# ─── Stage 1: dependencies ─────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: build ────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Values inlined into the client bundle at build time. They are public by
# design (they ship to the browser); real secrets are injected at runtime as
# Key Vault references and never appear here.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_ASSETS_URL
ARG BUILD_ID
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_ASSETS_URL=$NEXT_PUBLIC_ASSETS_URL \
    BUILD_ID=$BUILD_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ─── Stage 3: runtime ──────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# tini reaps zombies and forwards SIGTERM, so a revision swap drains cleanly
# instead of dropping connections and returning 502s.
#
# The package managers that ship inside node:22-alpine are deleted here. The
# header above already claimed this image carries none, and it was not true:
# npm, corepack and yarn were still present, and their bundled dependencies
# accounted for eight of the image's HIGH/CRITICAL findings — including the
# only CRITICAL (node-tar). Nothing at runtime needs them: the standalone
# output is started directly with `node server.js`.
#
# `apk upgrade --no-cache` pulls the latest patch versions of all installed
# packages (notably openssl/libssl3/libcrypto3) to fix CVEs that were
# present in the base Alpine snapshot at build time.
RUN apk upgrade --no-cache \
 && apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
