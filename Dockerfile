# One image for both processes: the API (`node dist/main.js`) and the worker (`node dist/worker.js`).

FROM node:24-bookworm-slim AS build
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
ENV npm_config_store_dir=/pnpm-store
RUN --mount=type=cache,id=ams-pnpm-store,target=/pnpm-store pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm exec prisma generate && pnpm build \
  && pnpm prune --prod --ignore-scripts

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 4200
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
