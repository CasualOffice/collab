# collab

Product-agnostic real-time collaboration server for the CasualOffice apps.

A single [Hocuspocus](https://tiptap.dev/hocuspocus) + [Yjs](https://yjs.dev) server
that provides:

- **CRDT collaboration** — one authoritative `Y.Doc` per room, wire-compatible with
  `y-prosemirror` (Docs) and `y-univer`/Yjs (Sheets).
- **Snapshots + seeding** — a new peer syncs from the server's room state; rooms can be
  seeded from persisted bytes.
- **Persistence** — pluggable host backend: `memory` / `local` / `s3` / `postgres`.
- **Auth** — personal accounts (signup/login/profile) + JWT, and WOPI host integration.
- **Versioning** — opaque version strings with optimistic `If-Match` concurrency.

It stores **opaque OOXML bytes** and does not parse documents — all `.docx` / `.xlsx`
knowledge lives in the editor clients. The only product-specific detail is the file
format, selected per deployment (see `CASUAL_FILE_EXT` below).

## Vendored, not forked

This repo is the single source of truth. It is vendored into both the Docs and Sheets
apps; each app deploys the **same** server with its own format + storage config:

| Product | `CASUAL_FILE_EXT` | Content-Type |
| --- | --- | --- |
| Docs   | `.docx` | `…wordprocessingml.document` |
| Sheets | `.xlsx` | `…spreadsheetml.sheet` (default) |

## Run

```bash
npm install
npm run dev      # tsx watch, :1234 (Hocuspocus) + HTTP API
npm run typecheck
```

## Config

See `.env.example` for the full list. Key vars:

| Var | Default | Meaning |
| --- | --- | --- |
| `CASUAL_FILE_EXT` | `.xlsx` | File extension / format for this deployment (`.docx` for Docs). |
| `CASUAL_FILE_CONTENT_TYPE` | derived from ext | Override the download/storage MIME. |
| `CASUAL_STORAGE` | `memory` | Persistence backend: `memory` \| `local` \| `s3` \| `postgres`. |
| `CASUAL_LOCAL_PATH` | `/data` | Root dir for the `local` backend. |
| `CASUAL_PG_URL` | — | Connection string for the `postgres` backend. |
| `CASUAL_PG_TABLE` | `casual_workbooks` | Table name for the `postgres` backend. |
| `CASUAL_S3_BUCKET` | — | Bucket for the `s3` backend (+ `CASUAL_S3_*`). |

License: Apache-2.0.
