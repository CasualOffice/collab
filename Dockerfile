# Collab server — Hocuspocus + Yjs. Runs the TS sources directly via tsx
# (the same `node --import tsx` entrypoint used in dev), matching the
# established start script. The full node:22 image is used (not slim) so
# better-sqlite3's native build has python3 + a toolchain available.
FROM node:22

WORKDIR /app

# Install prod deps first for layer caching. tsx lives in dependencies,
# so the runtime entrypoint resolves without devDependencies.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=1234
ENV HOST=0.0.0.0
EXPOSE 1234

# Default to ephemeral in-memory storage; override CASUAL_STORAGE +
# CASUAL_FILE_EXT per deployment (docs -> .docx, sheets -> .xlsx).
CMD ["npm", "start"]
