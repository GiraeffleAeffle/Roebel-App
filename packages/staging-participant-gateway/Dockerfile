FROM --platform=linux/amd64 docker.io/library/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS builder

ARG SOURCE_REVISION
ARG SOURCE_DATE_EPOCH
RUN test "${#SOURCE_REVISION}" -eq 40 \
    && case "${SOURCE_REVISION}" in *[!0-9a-f]*) exit 1;; esac \
    && test -n "${SOURCE_DATE_EPOCH}" \
    && case "${SOURCE_DATE_EPOCH}" in *[!0-9]*) exit 1;; esac

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /workspace
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=dependency-manifests . .
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    --mount=type=bind,from=pnpm-store,source=.,target=/pnpm/store,ro \
    pnpm --filter @roebel/staging-participant-gateway... install --frozen-lockfile --offline --ignore-scripts
COPY . .
RUN --mount=type=bind,from=corepack-cache,source=.,target=/root/.cache/node/corepack,ro \
    SOURCE_REVISION="$SOURCE_REVISION" pnpm --filter @roebel/staging-participant-gateway build
RUN set -eu; \
    if output="$(env -i PATH="$PATH" HOME=/tmp NODE_ENV=production \
      node packages/staging-participant-gateway/dist/staging-participant-gateway.cjs 2>&1)"; then \
      exit 1; \
    fi; \
    test "$output" = "staging_participant_gateway_not_explicitly_configured"

FROM --platform=linux/amd64 docker.io/library/node@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066 AS runtime

ARG SOURCE_REVISION

LABEL org.opencontainers.image.source="https://github.com/GiraeffleAeffle/Roebel-App" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      stadtstack.io/component="staging-participant-gateway" \
      stadtstack.io/staging-only="true" \
      stadtstack.io/civic-authority="none"

ENV NODE_ENV=production \
    HOME=/tmp

WORKDIR /app
COPY --from=builder --chown=65532:65532 /workspace/packages/staging-participant-gateway/dist/staging-participant-gateway.cjs /app/staging-participant-gateway.cjs

USER 65532:65532
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/app/staging-participant-gateway.cjs"]
