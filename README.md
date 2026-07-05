# ALLMYGEAR

ALLMYGEAR is a personal gear inventory and trip checklist web application. The current project is a vanilla JavaScript single-page app served by a small Go HTTP server. Persistent data, authentication, file storage and realtime updates are provided by Supabase.

The old localStorage-only mode is now only a migration/fallback concern. The primary runtime path is:

```text
Browser -> Go static/config server -> Supabase JS SDK -> self-hosted Supabase
```

## Main Features

- Gear inventory with category, brand, model, weight, price, purchase year, rating, comment and photo.
- User authentication through Supabase Auth.
- Per-user category ordering and sorting preferences.
- Storage locations for gear items.
- Trip checklists with selected gear items, dates and activity tags.
- Share links for individual items and checklists.
- Realtime synchronization for gear items and checklists.
- Photo upload to the `gear-photos` Supabase Storage bucket with signed URL caching on the client.
- Migration helper from legacy `localStorage` keys.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `cmd/main.go` | Go HTTP server. Serves `www/` and renders `www/js/supabase-config.js` from environment variables. |
| `www/index.html` | SPA HTML shell, CSP, auth/profile/share/checklist modals and script loading. |
| `www/js/app.js` | Main UI state, rendering, forms, checklists, sharing, image handling and realtime wiring. |
| `www/js/supabase-service.js` | Supabase client wrapper for auth, database, storage, sharing and subscriptions. |
| `www/style/style.css` | Application styles. |
| `supabase/migrations/` | Ordered Supabase migrations for the application schema. |
| `supabase/tests/visibility_access_checks.sql` | SQL scenario checks for visibility and entitlement behavior. |
| `sql/allmygear.sql` | Legacy schema/data snapshot kept for manual reference. |
| `sql/*_rows.sql` | Exported data rows for application tables. Treat as data snapshots, not migrations. |
| `supabase/docker-compose.yml` | Self-hosted Supabase stack. |
| `nginx/all-my-gear` | Production nginx reverse proxy example. |
| `scripts/*.sh` | Docker pull/run/stop and certbot helper scripts. |
| `Dockerfile` | Multi-stage Docker image for the Go server plus static assets. |
| `docs/` | Project analysis, architecture, data model and operations documentation. |

## Configuration

The Go server requires these environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `WWW_DIR` | yes | Directory with static assets. Docker value: `/app/www/`. Local value: `./www/`. Must include trailing slash because the server concatenates `wwwDir + "js/supabase-config.js"`. |
| `WWW_URL` | yes | Listen address, for example `:8080`. |
| `WWW_USE_SSL` | no | `true` or `1` makes the Go server use TLS directly. Production currently terminates TLS at nginx, so this is usually `false`. |
| `CERT_FILE` | when `WWW_USE_SSL=true` | TLS certificate path for direct Go TLS mode. |
| `KEY_FILE` | when `WWW_USE_SSL=true` | TLS key path for direct Go TLS mode. |
| `SUPABASE_URL` | yes | Public Supabase API URL exposed to the browser. |
| `SUPABASE_ANON_KEY` | yes | Supabase anonymous key exposed to the browser. Authorization must be enforced by RLS policies. |

Example local `.env`:

```env
WWW_DIR=./www/
WWW_URL=:8080
WWW_USE_SSL=false
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=replace-with-local-anon-key
```

Do not commit real secrets. The anon key is public by design, but service role keys, JWT secrets, SMTP passwords and database passwords must remain outside git.

## Local Development

Run the Go server:

```bash
go run ./cmd/main.go
```

Or build the binary:

```bash
make build
./bin/app
```

The app needs a reachable Supabase instance matching `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Opening `www/index.html` directly is no longer the normal path because `js/supabase-config.js` is a Go template rendered at request time.

## Docker

Build the application image:

```bash
make docker_build
```

Run the published image using the helper:

```bash
./scripts/run.sh
```

Before using `scripts/run.sh`, fill `SUPABASE_ANON_KEY` and confirm `SUPABASE_URL` matches the public Supabase endpoint. The script maps the app on host port `8080`.

## Production Shape

The checked-in nginx config routes:

- `/` to the Go app on `127.0.0.1:8080`
- `/auth`, `/rest`, `/storage`, `/realtime` to Supabase Kong on `127.0.0.1:8000`

TLS is terminated by nginx with Let's Encrypt certificates for `all-my-gear.pro`.

## Documentation

- [Project Analysis](docs/PROJECT_ANALYSIS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data Model](docs/DATA_MODEL.md)
- [Operations](docs/OPERATIONS.md)

## Current Risk Summary

- Authoritative database changes now live in `supabase/migrations`; `sql/*_rows.sql` files are data exports.
- Client code still calls legacy catalog objects `gear_catalog` and `search_gear_catalog`; normalized brand/category/activity catalogs now have migrations, but this older suggestion contract still needs a migration, compatibility view/RPC, or code removal.
- `gear-photos` Storage policies are present in `supabase/migrations/202607030005_subscription_visibility_access.sql`, but the bucket itself still needs explicit provisioning. Verify the policy path contract before rollout: the client uploads `{userId}/{itemId}.jpg`, while the current SQL policies inspect the first path segment as a gear item id.
- `www/js/app.js` is large and mixes UI, state, data mapping and workflows in one file; future feature work should isolate risky changes.

## Verification

Basic backend check:

```bash
go test ./...
```

Build check:

```bash
make build
```

Frontend and migration contract checks use Node's built-in test runner:

```bash
node --test tests/*.mjs
```
