# syntax=docker/dockerfile:1
# Build from the repository root:
# docker build -f apps/mini-apps/roebel-data/Dockerfile --platform linux/amd64 .
#
# This Dockerfile deliberately copies only this Mini App and its two workspace
# dependencies. It cannot add repository .env files, Hetzner credentials or
# other private workspace material to the build context layers.
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/miniapp-sdk/package.json ./packages/miniapp-sdk/package.json
COPY packages/stadtstack-federation-client/package.json ./packages/stadtstack-federation-client/package.json
COPY apps/mini-apps/roebel-data/package.json ./apps/mini-apps/roebel-data/package.json

RUN --mount=type=cache,id=roebel-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @netizen/miniapp-roebel-data...

COPY packages/miniapp-sdk ./packages/miniapp-sdk
COPY packages/stadtstack-federation-client ./packages/stadtstack-federation-client
COPY apps/mini-apps/roebel-data ./apps/mini-apps/roebel-data

# These values are public build configuration, never credentials. The checks
# prevent a staging image from silently becoming the full wallet/economy app.
ARG NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO=walkthrough
ARG NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE=marienfelder
ARG NEXT_PUBLIC_MINIAPP_BASE_PATH=
ENV NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL=${NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL} \
    NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO=${NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO} \
    NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE} \
    NEXT_PUBLIC_MINIAPP_BASE_PATH=${NEXT_PUBLIC_MINIAPP_BASE_PATH}

RUN test -n "$NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL" && \
    test "$NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO" = "walkthrough" && \
    test "$NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE" = "marienfelder" && \
    pnpm --filter @netizen/miniapp-roebel-data build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

RUN groupadd --system --gid 1001 nextjs && \
    useradd --system --uid 1001 --gid nextjs nextjs

# Next's standalone trace preserves the monorepo path for this app.
COPY --from=build --chown=nextjs:nextjs /workspace/apps/mini-apps/roebel-data/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /workspace/apps/mini-apps/roebel-data/.next/static ./apps/mini-apps/roebel-data/.next/static
COPY --from=build --chown=nextjs:nextjs /workspace/apps/mini-apps/roebel-data/public ./apps/mini-apps/roebel-data/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/mini-apps/roebel-data/server.js"]
