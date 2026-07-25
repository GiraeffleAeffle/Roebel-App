FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json ./
# roebel-id has no workspace-internal deps — install standalone (small image, no monorepo copy needed).
# Build context is apps/roebel-id itself (see fly.toml / README), so this Dockerfile is self-contained.
RUN pnpm install --prod=false --ignore-workspace
COPY . .
RUN pnpm build
EXPOSE 3010
CMD ["node", "dist/index.js"]
