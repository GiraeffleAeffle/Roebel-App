FROM --platform=linux/amd64 docker.io/library/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS builder

ARG SOURCE_REVISION
ARG SOURCE_DATE_EPOCH
RUN test "${#SOURCE_REVISION}" -eq 40 \
    && case "${SOURCE_REVISION}" in *[!0-9a-f]*) exit 1;; esac \
    && test -n "${SOURCE_DATE_EPOCH}" \
    && case "${SOURCE_DATE_EPOCH}" in *[!0-9]*) exit 1;; esac

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
WORKDIR /workspace
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/nostr/package.json ./packages/nostr/package.json
COPY packages/staging-relay/package.json ./packages/staging-relay/package.json
COPY packages/nostr ./packages/nostr
COPY packages/staging-relay ./packages/staging-relay
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    --mount=type=bind,from=pnpm-store,source=.,target=/pnpm/store,ro \
    pnpm --filter @roebel/staging-relay... install --frozen-lockfile --offline --ignore-scripts
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    pnpm --filter @roebel/staging-relay build

FROM --platform=linux/amd64 docker.io/library/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/GiraeffleAeffle/Roebel-App" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      stadtstack.io/component="roebel-staging-relay" \
      stadtstack.io/environment="isolated-staging-e2e" \
      stadtstack.io/civic-authority="none"
ENV NODE_ENV=production HOME=/tmp
WORKDIR /app
COPY --from=builder --chown=65532:65532 /workspace/packages/staging-relay/dist/staging-relay.cjs /app/staging-relay.cjs
USER 65532:65532
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/staging-relay.cjs"]
