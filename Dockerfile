# syntax=docker/dockerfile:1

# ---- build stage ---------------------------------------------------------
# Installs devDependencies (vite/esbuild/typescript) and produces the
# prebuilt, dependency-free runtime bundle in /app/dist.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN node scripts/build-npm.mjs

# ---- runtime stage -------------------------------------------------------
# The bundle is self-contained (express/dotenv/@google/genai are inlined), so
# no node_modules are shipped and no install step runs at runtime.
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    CASCADE_DOCKER=1 \
    CASCADE_HOME=/data \
    CASCADE_PORT=3000 \
    CASCADE_ROUTER_PORT=19080
WORKDIR /app
COPY --from=build /app/package.json /app/metadata.json ./
COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY --from=build /app/configs ./configs
COPY --from=build /app/cascade-router/catalog.json ./cascade-router/catalog.json
VOLUME ["/data"]
EXPOSE 3000 19080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CASCADE_PORT||3000)+'/vendor/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/cascade.js"]
CMD ["start"]
