# Dedicated, app-agnostic collab server image — the @casualoffice/collab
# engine ONLY (Hocuspocus WS `/yjs` sync + REST `/api/rooms`, `/auth`,
# `/files`, `/wopi`, `/health`). NO SPA is bundled: any host app (Casual
# Drive, Docs, Sheets, future apps) points its single collab deployment at
# this one image instead of reusing a product-bundled image as the gateway.
# The server is format-agnostic (room = fileId); the file format is chosen
# per deployment via CASUAL_FILE_EXT.
#
# Runs the TS sources directly via tsx (the same `node --import tsx`
# entrypoint used in dev), matching the established `npm start` script. The
# full node:22 image is used (not slim) so better-sqlite3's native build has
# python3 + a toolchain available.
FROM node:22

LABEL org.opencontainers.image.title="casualoffice/collab" \
      org.opencontainers.image.description="App-agnostic real-time collaboration server (Hocuspocus + Yjs on Fastify). One deployment brokers .docx + .xlsx + future rooms for any host app. Collab engine only — no SPA." \
      org.opencontainers.image.source="https://github.com/CasualOffice/collab" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Reproducible install from the committed lockfile — npm ci fails if
# package.json and the lockfile disagree, so builds can't silently drift.
# tsx lives in dependencies, so the runtime entrypoint resolves without
# devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# The data dir holds local/SQLite storage; make it writable by the non-root
# runtime user. On a NAMED volume Docker seeds ownership from this; on a BIND
# mount the host dir must already be writable by uid 1000 (node).
RUN mkdir -p /data && chown node:node /data

# The server listens on PORT (defaults to 3000 in src/index.ts; pinned here
# so EXPOSE / HEALTHCHECK / host wiring all agree). HOST=0.0.0.0 so the
# container is reachable from outside. Override any of these per deployment.
ENV PORT=1234
ENV HOST=0.0.0.0
EXPOSE 1234

# This image IS the standalone collab gateway — there is no separate
# GATEWAY_HOST=inline vs. sidecar mode (that is a product-image concept, not
# a collab-server one). Persistence defaults to ephemeral in-memory storage;
# set CASUAL_STORAGE (local|s3|postgres) + CASUAL_FILE_EXT (docs -> .docx,
# sheets -> .xlsx) per deployment. CASUAL_JWT_SECRET MUST equal the host
# app's token-signing secret for auth/WOPI to validate (see docs/DOCKERHUB.md).

# Liveness probe against the unauthenticated /health endpoint. Uses Node's
# built-in fetch (node 22) so no curl/wget need be installed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1234)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Drop root — a compromised process then can't act as root against a mounted
# host volume or the container filesystem.
USER node

CMD ["npm", "start"]
