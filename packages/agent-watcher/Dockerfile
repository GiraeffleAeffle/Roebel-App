# syntax=docker/dockerfile:1.7

FROM --platform=linux/amd64 docker.io/library/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/nostr/package.json ./packages/nostr/package.json
COPY packages/stadtstack-federation-client/package.json ./packages/stadtstack-federation-client/package.json
COPY packages/agent-watcher/package.json ./packages/agent-watcher/package.json

COPY packages/nostr ./packages/nostr
COPY packages/stadtstack-federation-client ./packages/stadtstack-federation-client
COPY packages/agent-watcher ./packages/agent-watcher
RUN --mount=type=cache,id=roebel-public-mecky-pnpm-v9-linux-amd64,target=/pnpm/store,sharing=locked \
    pnpm --filter @netizen-labs/agent-watcher... install --frozen-lockfile
RUN pnpm --filter @netizen-labs/agent-watcher build

FROM --platform=linux/amd64 docker.io/library/node@sha256:7c269ea419bfbaef1f5eed57e58016395bbe3036176411025a5093e39a948dcf AS runtime

ARG SOURCE_REVISION
RUN test "${#SOURCE_REVISION}" -eq 40 \
    && case "${SOURCE_REVISION}" in *[!0-9a-f]*) exit 1;; esac

LABEL org.opencontainers.image.source="https://github.com/GiraeffleAeffle/Roebel-App" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      stadtstack.io/component="public-mecky" \
      stadtstack.io/evidence-boundary="reviewed-public-only" \
      stadtstack.io/civic-authority="none"

ENV NODE_ENV=production \
    HOME=/tmp

WORKDIR /app
COPY --from=builder --chown=65532:65532 /workspace/packages/agent-watcher/dist/agent-watcher.cjs /app/agent-watcher.cjs

USER 65532:65532
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/agent-watcher.cjs"]
