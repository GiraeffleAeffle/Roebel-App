FROM node:22-slim AS base
# Node 22 (LTS): @supabase/supabase-js needs a native global WebSocket (Node 22+);
# on node:20 createClient() throws "native WebSocket not found" and the app crash-loops.
# Pin pnpm to the repo's version so corepack doesn't pull an incompatible latest (11.x needs Node>=22).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json ./
# roebel-id has no workspace-internal deps — install standalone (small image, no monorepo copy needed).
# Build context is apps/roebel-id itself (see fly.toml / README), so this Dockerfile is self-contained.
RUN pnpm install --prod=false --ignore-workspace
COPY . .
RUN pnpm build
EXPOSE 3010
CMD ["node", "dist/index.js"]
