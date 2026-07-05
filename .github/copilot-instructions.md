# ALLMYGEAR Copilot Instructions

## Project Overview

ALLMYGEAR is a vanilla JavaScript single-page gear inventory and trip checklist application served by a small Go HTTP server. The primary persistence layer is Supabase, not browser-only `localStorage`.

Runtime path:

```text
Browser -> Go static/config server -> Supabase JS SDK -> Supabase Auth/PostgREST/Storage/Realtime
```

## Architecture

- `cmd/main.go`: Go server. Loads `.env`, validates runtime configuration, serves `www/`, and renders `www/js/supabase-config.js` from environment variables.
- `www/index.html`: SPA shell, CSP, modals, tabs and script loading.
- `www/js/app.js`: Main UI/state/workflow file. It is intentionally framework-free but very large, so keep changes scoped.
- `www/js/supabase-service.js`: Supabase wrapper for auth, CRUD, storage, sharing and realtime subscriptions.
- `sql/allmygear.sql`: Schema snapshot. Treat it as documentation/snapshot until proper migrations exist.
- `supabase/docker-compose.yml`: Self-hosted Supabase stack.
- `nginx/all-my-gear`: Production reverse proxy example.

## Important Runtime Configuration

The Go server requires:

- `WWW_DIR`: static files directory, usually `./www/` locally or `/app/www/` in Docker. Keep the trailing slash.
- `WWW_URL`: listen address, for example `:8080`.
- `WWW_USE_SSL`: direct Go TLS mode. Usually `false` when nginx terminates TLS.
- `CERT_FILE` and `KEY_FILE`: required only when `WWW_USE_SSL=true`.
- `SUPABASE_URL`: public Supabase API URL.
- `SUPABASE_ANON_KEY`: public anon key injected into browser JavaScript.

Do not add service role keys, JWT secrets, database passwords or SMTP passwords to the repository.

## Data Model

Primary tables used by the client:

- `gear_items`
- `checklists`
- `category_order`
- `storages`
- `shared_items`

Runtime objects also expected by the client:

- `gear_catalog`
- `search_gear_catalog`
- Supabase Storage bucket `gear-photos`

The browser uses the anon key, so security must be enforced by Supabase RLS and Storage policies. Client-side `.eq('user_id', currentUser.id)` filters are not a security boundary.

## Current Known Gaps

- `sql/allmygear.sql` defines RLS policies for `category_order` and `storages`, but not for all tables used by the client.
- `gear_catalog`, `search_gear_catalog` and `gear-photos` are referenced by JavaScript but are not defined in the schema snapshot.
- SQL files are snapshots, not ordered migrations.
- `www/js/app.js` mixes many workflows in one file; avoid unrelated refactors.

## Development Workflow

Local run:

```bash
go run ./cmd/main.go
```

Build:

```bash
make build
```

Backend verification:

```bash
go test ./...
```

Docker build:

```bash
make docker_build
```

## Change Guidelines

- Keep changes minimal and scoped to the requested behavior.
- Prefer existing vanilla JS patterns unless a larger refactor is explicitly requested.
- Do not assume direct `www/index.html` file opening is supported; the Supabase config script is rendered by Go.
- Before data-access changes, inspect both `www/js/supabase-service.js` and `sql/allmygear.sql`.
- Before production/security claims, verify live Supabase RLS and Storage policies, not only frontend filters.
- For docs, keep README short and put details in `docs/`.
