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
- Confirm port mapping `127.0.0.1:8080:8080`; the app should not be exposed directly on a public interface.
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
- Confirm Supabase public ports in `supabase/docker-compose.yml` are bound to `127.0.0.1` when nginx is the public entrypoint.

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

The nginx site also owns production security headers. CSP should be changed in `nginx/all-my-gear`, not by adding a second meta policy to `www/index.html`.

### Maintenance Mode

The production nginx config checks `/var/lib/all-my-gear/maintenance.enabled` on every new request. While the flag exists, `/`, `/auth`, `/rest`, `/storage` and `/realtime` return HTTP 503 with the standalone maintenance page. The page does not depend on the app or Supabase containers.

Install the page and updated nginx config once:

```bash
sudo ./scripts/maintenance.sh install
sudo cp nginx/all-my-gear /etc/nginx/sites-available/all-my-gear
sudo nginx -t
sudo systemctl reload nginx
```

Enable maintenance mode before a deployment or database migration:

```bash
sudo ./scripts/maintenance.sh on
curl -I https://all-my-gear.pro/
```

The expected response is `503 Service Unavailable`. New REST, Auth, Storage and Realtime requests are blocked as well:

```bash
curl -I https://all-my-gear.pro/rest/v1/
curl -I https://all-my-gear.pro/auth/v1/health
```

Check or disable the mode:

```bash
sudo ./scripts/maintenance.sh status
sudo ./scripts/maintenance.sh off
curl -I https://all-my-gear.pro/
```

Disabling removes only the flag and takes effect without reloading nginx. Do not disable maintenance mode until database, container and public smoke checks have passed.

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

Production paths used by the current installation:

| Purpose | Path |
| --- | --- |
| Supabase compose and volumes | `/root/all-my-gear` |
| Ordered SQL migrations | `/root/migrations` |
| Operational scripts | `/root/scripts` |
| Release documentation/staging | `/root/deploy-visibility-20260723` |
| Backups | `/root/all-my-gear-backups` |

Use an immutable application image tag for every release. Do not deploy `latest`: retaining the previous tagged container and image makes rollback deterministic.

1. Build, test and publish an immutable app image.
2. Upload migrations, scripts, nginx assets and release documentation.
3. Pull the new image on the server.
4. Take and verify a fresh backup:

```bash
BACKUP_ROOT=/root/all-my-gear-backups \
SUPABASE_DIR=/root/all-my-gear \
DB_USER=supabase_admin \
/root/scripts/backup.sh
```

5. Enable maintenance mode and verify HTTP 503:

```bash
/root/scripts/maintenance.sh on
curl -I https://all-my-gear.pro/
```

6. Preview, apply and verify database migrations:

```bash
MIGRATIONS_DIR=/root/migrations DB_USER=supabase_admin DRY_RUN=true \
  /root/scripts/apply-migrations.sh
MIGRATIONS_DIR=/root/migrations DB_USER=supabase_admin \
  /root/scripts/apply-migrations.sh
```

7. Stop the old app container, rename it to a release-specific rollback name and set its restart policy to `no`. Start the new container as `all-my-gear`.
8. Check container state:

```bash
docker ps
docker logs all-my-gear --tail 100
```

9. Check nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
```

10. Check the app upstream directly while maintenance mode remains enabled:

```bash
curl -I http://127.0.0.1:8080/
```

11. Disable maintenance mode and check the public app:

```bash
curl -I https://all-my-gear.pro/
curl -I https://all-my-gear.pro/js/supabase-config.js
```

12. Check CSP and Supabase routes:

```bash
curl -I https://all-my-gear.pro/ | grep -i content-security-policy
curl -I https://all-my-gear.pro/auth/v1/health
```

13. Verify the migration ledger and the active image:

```bash
docker inspect all-my-gear --format '{{.Config.Image}} {{.State.Status}}'
docker exec supabase-db psql -U supabase_admin -d postgres -c \
  'select filename, applied_at from public.schema_migrations order by filename desc limit 10;'
```

Keep the rollback container stopped with restart policy `no` until the release observation period is complete. Removing the rollback container or old image is a separate destructive operation and must not be part of the normal deployment procedure.

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
- CSP `script-src` allows `https://cdn.jsdelivr.net`.
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
- `image_path` values match `<gear_item_id>/image.jpg`.
- Browser image requests should use Supabase signed URLs. A request like `https://all-my-gear.pro/<gear_item_id>/image.jpg` means a raw Storage path leaked into an `<img src>`.
- Signed URL cache in browser is not stale. Clearing localStorage cache keys can help during debugging.

### Share links fail

Check:

- `shared_items` row exists for `share_code`.
- `expires_at` is in the future.
- Anonymous read policy exists if unauthenticated share viewing is required.
- Photo paths inside `item_data` can be resolved to signed URLs.
- `shared_items.item_data` does not contain `data:image` payloads.

### Legacy Image Payloads

Current storage contract:

```text
gear_items.image_path = <gear_item_id>/image.jpg
shared_items.item_data.image_path = <gear_item_id>/image.jpg
shared_items.item_data.items[*].image_path = <gear_item_id>/image.jpg
```

Useful production checks:

```sql
select
  count(*) filter (where image_path like 'data:%') as item_data_urls,
  max(length(image_path)) as max_image_path_len,
  pg_size_pretty(pg_total_relation_size('public.gear_items')) as gear_items_total_size
from public.gear_items;

select
  count(*) filter (where item_data::text like '%data:image%') as shares_with_data_urls,
  max(length(item_data::text)) as max_item_data_len,
  pg_size_pretty(pg_total_relation_size('public.shared_items')) as shared_items_total_size
from public.shared_items;
```

If rows contain legacy data URLs:

- Move `gear_items.image_path` data URLs into the `gear-photos` bucket through the Storage API, not by writing directly into `volumes/storage`.
- Run `202607050009_normalize_shared_item_image_paths.sql` after `gear_items.image_path` contains canonical Storage paths.
- Run `vacuum full analyze public.gear_items` and/or `vacuum full analyze public.shared_items` only after successful backups and verification.

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

For photo/storage changes, explicitly check that the `gear-photos` bucket exists and that Storage policies match the client object path format `<gear_item_id>/image.jpg`.
