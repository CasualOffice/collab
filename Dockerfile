# Collab server — Hocuspocus + Yjs. Runs the TS sources directly via tsx
# (the same `node --import tsx` entrypoint used in dev), matching the
# established start script. The full node:22 image is used (not slim) so
# better-sqlite3's native build has python3 + a toolchain available.
FROM node:22

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

ENV PORT=1234
ENV HOST=0.0.0.0
EXPOSE 1234

# Drop root — a compromised process then can't act as root against a mounted
# host volume or the container filesystem.
USER node

# Default to ephemeral in-memory storage; override CASUAL_STORAGE +
# CASUAL_FILE_EXT per deployment (docs -> .docx, sheets -> .xlsx).
CMD ["npm", "start"]
