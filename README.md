# collab

**Product-agnostic real-time collaboration server for the [CasualOffice](https://github.com/CasualOffice) apps.**

A single [Hocuspocus](https://tiptap.dev/hocuspocus) + [Yjs](https://yjs.dev) service that
powers live co-editing in **Casual Sheets** and **Casual Docs**. It stores **opaque OOXML
bytes** and relays CRDT updates — it never parses documents, so all `.xlsx` / `.docx`
knowledge stays in the editor clients. The only product-specific detail is the file
format, chosen per deployment via one env var.

![license](https://img.shields.io/badge/license-Apache--2.0-blue) ![node](https://img.shields.io/badge/node-%E2%89%A522-green) ![runtime](https://img.shields.io/badge/Fastify%20%2B%20Hocuspocus%20%2B%20Yjs-000)

## What it does

- **CRDT collaboration** — one authoritative `Y.Doc` per room over a WebSocket, wire-compatible
  with `y-prosemirror` (Docs) and `y-univer` / Yjs (Sheets).
- **Snapshots + seeding** — a new peer syncs from the server's room state; rooms can be
  seeded from persisted bytes and snapshotted back out.
- **Pluggable persistence** — `memory` / `local` / `s3` / `postgres` document hosts, plus
  optional Redis for `Y.Doc` room snapshots that survive restarts.
- **Auth** — personal accounts (signup / login / profile / avatar) with JWT, and WOPI host
  integration for embedding in a file manager (Casual Drive).
- **Versioning** — opaque version strings with optimistic `If-Match` concurrency.
- **Room lifecycle** — capacity caps + idle eviction; password-protected and seeded rooms
  are never evicted.

## Vendored, not forked

This repo is the single source of truth. It is added as a git **submodule** into both the
Docs and Sheets apps (at `apps/server`), and each app deploys the **same** server with its
own format + storage config:

| Product | `CASUAL_FILE_EXT` | Content-Type |
| --- | --- | --- |
| Sheets | `.xlsx` (default) | `…spreadsheetml.sheet` |
| Docs   | `.docx`           | `…wordprocessingml.document` |

## Run

```bash
npm install
npm run dev        # tsx watch — HTTP API + Hocuspocus WS on :3000
npm run typecheck
npm test           # node --test (unit)
```

### Docker

```bash
docker build -t casualoffice/collab .
docker run -p 3000:3000 \
  -e CASUAL_FILE_EXT=.xlsx \
  -e CASUAL_STORAGE=memory \
  casualoffice/collab
```

## API surface

HTTP (Fastify) + a single WebSocket endpoint for sync. Auth, files, and admin routes are
only mounted when personal mode is enabled.

| Surface | Endpoint | Notes |
| --- | --- | --- |
| **Sync** | `ws /yjs` | Hocuspocus — CRDT updates, one `Y.Doc` per room. |
| **Rooms** | `GET /health`, `GET /api/rooms`, `POST /api/rooms` | Liveness, room list, create a room (`{ password? }`). |
| **WOPI** | `GET /api/files`, `GET /api/me`, `POST /api/tokens` | Host integration (CheckFileInfo / GetFile / PutFile). |
| **Auth** | `POST /auth/{signup,login,logout,change-password,delete-account}`, `GET /auth/{me,status}` | Personal accounts + JWT cookies. |
| **Profile** | `GET /auth/profile`, `POST`·`DELETE /auth/profile/avatar` | Display name + avatar. |
| **Files** | `GET`·`POST /files` (+ per-file snapshot routes) | Per-user document storage. |
| **Admin** | `GET /api/admin/{status,config}` | Deployment status + resolved config. |

## Config

See [`.env.example`](./.env.example) for the full list. Key vars:

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address. |
| `CASUAL_FILE_EXT` | `.xlsx` | File extension / format (`.docx` for Docs). |
| `CASUAL_FILE_CONTENT_TYPE` | derived from ext | Override the download / storage MIME. |
| `CASUAL_STORAGE` | `memory` | Document host: `memory` \| `local` \| `s3` \| `postgres`. |
| `CASUAL_LOCAL_PATH` | `/data` | Root dir for the `local` host. |
| `CASUAL_PG_URL` / `CASUAL_PG_TABLE` | — / `casual_workbooks` | Postgres host connection + table. |
| `CASUAL_S3_BUCKET` | — | Bucket for the `s3` host (+ `CASUAL_S3_*`). |
| `REDIS_URL` | — | Enables Redis room-snapshot persistence. |
| `CASUAL_REDIS_PREFIX` | `casual:room:` | Redis key namespace — set per product so they don't collide. |
| `RATE_LIMIT_ENABLED` | `true` | Throttle room creation + write paths (set `false` for local dev / e2e). |

> **Upgrading an existing Sheets deployment:** the prefix used to be a hardcoded
> `casual-sheets:room:`. Set `CASUAL_REDIS_PREFIX=casual-sheets:room:` so rooms persisted by
> older images stay readable.

## License

[Apache-2.0](./LICENSE).
