# `casualoffice/collab` — the app-agnostic collaboration server

This image is the **standalone `@casualoffice/collab` engine** — Hocuspocus + Yjs
on Fastify — and nothing else. It ships **no SPA**. Run **one** deployment of this
image and point every host app (Casual Drive, Docs, Sheets, and future apps) at it
as their shared collab gateway, instead of reusing a product-bundled image (e.g.
`casualoffice/docs`) as the gateway.

The server is **format-agnostic**: a room is just a `fileId`, and one server brokers
`.docx`, `.xlsx`, and future room types simultaneously. It relays opaque OOXML bytes
and CRDT updates; it never parses documents.

## What it serves (one origin)

| Surface | Endpoint | Notes |
| --- | --- | --- |
| **Sync** | `ws /yjs` | Hocuspocus — CRDT updates, one `Y.Doc` per room. |
| **Rooms** | `GET /health`, `GET`·`POST /api/rooms` | Liveness, room list, create-room. |
| **Auth** | `POST /auth/{signup,login,logout,…}`, `GET /auth/{me,status}` | Personal accounts + JWT cookies. |
| **Files** | `GET`·`POST /files` (+ per-file snapshot routes) | Per-user document storage. |
| **WOPI** | `GET /api/files`, `GET /api/me`, `POST /api/tokens` | Host integration for embedding. |

## Quick start

```bash
docker run --rm -p 1234:1234 \
  -e CASUAL_JWT_SECRET=<must-equal-host-token-signing-secret> \
  -e CASUAL_STORAGE=memory \
  casualoffice/collab:latest
```

Then a host app connects its collab client to `ws://<host>:1234/yjs` and its REST
calls to `http://<host>:1234/api/rooms`. Liveness: `GET /health` → `{ ok: true, … }`.

## Environment contract

The single hard requirement for a host integration:

> **`CASUAL_JWT_SECRET` on this collab server MUST be byte-for-byte identical to the
> secret the host app uses to sign its access tokens.** The collab server validates
> incoming tokens with this secret; a mismatch (or an unset/short `< 16` char secret,
> which disables JWT auth entirely) means auth/WOPI requests won't validate.

| Var | Default | Meaning |
| --- | --- | --- |
| `CASUAL_JWT_SECRET` | *(unset → auth disabled)* | **Must equal the host's token-signing secret.** ≥ 16 chars. |
| `PORT` / `HOST` | `1234` / `0.0.0.0` (image) | Listen address. (`src/index.ts` default is `3000`; the image pins `1234`.) |
| `CASUAL_FILE_EXT` | `.xlsx` | Per-deployment file format (`.docx` for Docs rooms). |
| `CASUAL_FILE_CONTENT_TYPE` | derived from ext | Override the download / storage MIME. |
| `CASUAL_STORAGE` | `memory` | Document host: `memory` \| `local` \| `s3` \| `postgres`. |
| `CASUAL_LOCAL_PATH` | `/data` | Root dir for the `local` host (mount a volume to persist). |
| `CASUAL_PG_URL` / `CASUAL_PG_TABLE` | — / `casual_workbooks` | Postgres host. |
| `CASUAL_S3_BUCKET` (+ `CASUAL_S3_*`) | — | S3/MinIO/R2/B2 host. |
| `REDIS_URL` | — | Enables Redis room-snapshot persistence across restarts. |
| `CASUAL_REDIS_PREFIX` | `casual:room:` | Redis key namespace — set per product so they don't collide. |
| `SECURE_COOKIES` | — | `true` behind HTTPS for `__Host-`-prefixed cookies. |

> There is **no `GATEWAY_HOST` mode** here — that is a product-image concept. This
> image *is* the collab gateway; it always runs the engine standalone.

See [`.env.example`](../.env.example) for the full list.

## Health

A Docker `HEALTHCHECK` probes the unauthenticated `GET /health` endpoint (Node's
built-in `fetch`, no curl needed). Orchestrators can use the same endpoint for
readiness/liveness.

## Publishing

Tag-driven via `.github/workflows/docker-publish.yml`: push a SemVer tag (`vX.Y.Z`)
to build + push `casualoffice/collab:X.Y.Z` and `:latest` (the leading `v` is
stripped). Requires a `dockerhub` GitHub Environment with `DOCKERHUB_USERNAME` /
`DOCKERHUB_TOKEN` secrets and a `casualoffice/collab` Docker Hub repository.
