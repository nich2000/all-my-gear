# Operations

## Local Run

Create a local `.env` with non-secret or local-only values:

```env
WWW_DIR=./www/
WWW_URL=:8080
WWW_USE_SSL=false
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=replace-with-local-anon-key
```

Start the app:

```bash
go run ./cmd/main.go
```

Open:

```text
http://localhost:8080
```

The app will load only if the configured Supabase endpoint is reachable and compatible with the expected schema.

## Build

```bash
make build
```

Output:

```text
./bin/app
```

## Docker App Image

Build:

```bash
make docker_build
```

Run with the helper:

```bash
./scripts/run.sh
```

Review `scripts/run.sh` before running in production:

- Fill `SUPABASE_ANON_KEY`.
- Confirm `SUPABASE_URL`.
- Confirm port mapping `8080:8080`.
- Confirm `WWW_USE_SSL=false` if TLS is terminated by nginx.

Stop:

```bash
./scripts/stop.sh
```

## Self-Hosted Supabase

Supabase is represented by `supabase/docker-compose.yml`.

Common commands from `supabase/`:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f
docker compose down
```

Before production use:

- Replace default secrets in `supabase/.env`.
- Back up Postgres before changing image versions.
- Confirm `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL` and redirect URLs match the public domain.
- Configure SMTP if email signup, confirmation or password recovery is enabled.
- Verify OAuth provider callback URLs if social login is enabled.

## nginx

Production config is checked in at `nginx/all-my-gear`.

Expected routing:

| Public path | Upstream |
| --- | --- |
| `/` | `http://127.0.0.1:8080` |
| `/auth` | `http://127.0.0.1:8000` |
| `/rest` | `http://127.0.0.1:8000` |
| `/storage` | `http://127.0.0.1:8000` |
| `/realtime` | `http://127.0.0.1:8000` |

Validation commands on the server:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## TLS Certificates

Helper:

```bash
./scripts/refresh_cert.sh
```

It calls certbot for:

- `all-my-gear.pro`
- `www.all-my-gear.pro`

After renewal, reload nginx if certbot does not do it automatically.

## Deployment Checklist

1. Build and publish the app image.
2. Pull the new image on the server.
3. Stop the old `all-my-gear` container.
4. Start the new container with the correct environment.
5. Check container state:

```bash
docker ps
docker logs all-my-gear --tail 100
```

6. Check nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
```

7. Check public app:

```bash
curl -I https://all-my-gear.pro/
curl -I https://all-my-gear.pro/js/supabase-config.js
```

8. Check Supabase routes:

```bash
curl -I https://all-my-gear.pro/auth/v1/health
```

## Backup And Restore

The repository contains exported row snapshots in `sql/*_rows.sql`, but these should not be treated as the only backup mechanism.

Recommended production backup scope:

- Postgres database dump.
- Supabase Storage objects for `gear-photos`.
- `supabase/.env` stored in a secure password manager or secret store.
- nginx site config and certificate renewal settings.

## Troubleshooting

### Go server exits immediately

Check required environment variables:

- `WWW_DIR`
- `WWW_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `CERT_FILE` and `KEY_FILE` if `WWW_USE_SSL=true`

### Browser says Supabase client is not initialized

Check:

- Supabase SDK from jsDelivr is reachable.
- CSP allows `https://cdn.jsdelivr.net`.
- `/js/supabase-config.js` returns valid JavaScript with rendered values.

### Data loads but users see wrong or excessive data

Treat as a Supabase RLS incident. Verify policies in the live database, especially for:

- `gear_items`
- `checklists`
- `shared_items`
- Storage bucket `gear-photos`

### Photos do not render

Check:

- `gear-photos` bucket exists.
- Storage policies allow expected upload/read/remove behavior.
- `image_path` values match `{userId}/{itemId}.jpg`.
- Signed URL cache in browser is not stale. Clearing localStorage cache keys can help during debugging.

### Share links fail

Check:

- `shared_items` row exists for `share_code`.
- `expires_at` is in the future.
- Anonymous read policy exists if unauthenticated share viewing is required.
- Photo paths inside `item_data` can be resolved to signed URLs.

## Routine Verification

Run before claiming backend changes are good:

```bash
go test ./...
make build
```

Run static frontend and migration contract tests:

```bash
node --test tests/*.mjs
```

For user-facing frontend changes, add a browser smoke check:

- App loads.
- Sign-in modal opens.
- Authenticated inventory loads.
- Add/edit/delete item works.
- Checklist tab lazy-loads.
- Photo upload and signed URL display work.

For photo/storage changes, explicitly check that the `gear-photos` bucket exists and that Storage policies match the client object path format `{userId}/{itemId}.jpg`.
