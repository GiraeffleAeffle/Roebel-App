FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app
COPY apps/roebel-id/package.json apps/roebel-id/
RUN cd apps/roebel-id && pnpm install --prod=false
COPY apps/roebel-id/ apps/roebel-id/
RUN cd apps/roebel-id && pnpm build
EXPOSE 3010
CMD ["node", "apps/roebel-id/dist/index.js"]
