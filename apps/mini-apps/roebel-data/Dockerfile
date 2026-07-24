# syntax=docker/dockerfile:1
#
# The public preview is a static export built natively before this image is
# assembled. This image intentionally contains no Node runtime, package
# manager, build tooling, SDK credentials, or server-side API capability.
#
# Build from a deliberately staged context whose layout keeps the app path:
# docker build --platform linux/amd64 \
#   -f apps/mini-apps/roebel-data/Dockerfile staged-context

FROM nginxinc/nginx-unprivileged:1.27-alpine

ARG SOURCE_REVISION
ARG STADTSTACK_PREVIEW_CONTRACT_SHA256

LABEL org.opencontainers.image.source="https://github.com/GiraeffleAeffle/Roebel-App" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      stadtstack.io/preview-contract-sha256="${STADTSTACK_PREVIEW_CONTRACT_SHA256}" \
      stadtstack.io/authority="none" \
      stadtstack.io/classification="synthetic-demo-only" \
      stadtstack.io/write-posture="read-only-public-preview" \
      stadtstack.io/runtime="static-export"

COPY apps/mini-apps/roebel-data/nginx.preview.conf /etc/nginx/conf.d/default.conf
COPY apps/mini-apps/roebel-data/out /usr/share/nginx/html

EXPOSE 8080
