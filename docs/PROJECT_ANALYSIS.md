# Project Analysis

## Executive Summary

ALLMYGEAR is a personal gear inventory and checklist SPA. The application is mostly client-side, with a small Go server that serves static files and injects Supabase configuration into the browser. Supabase is the real backend: authentication, PostgREST database access, Storage and Realtime are called directly from JavaScript with the anon key.

The project is usable as a small self-hosted product, and most of the public schema is now represented by ordered migrations. The highest remaining operational risk is not the Go server; it is the remaining Supabase contract around legacy catalog suggestions and the exact Storage bucket/path policy for photos.

## What The Application Does

- Maintains a per-user inventory of gear items.
- Stores item attributes: category, name, brand, model, weight, price, year, rating, comment, photo path and storage location.
- Lets users manage custom storage locations.
- Lets users build trip checklists from inventory items.
- Supports checklist dates and activity tags.
- Supports public share links for individual items and checklists with a 30-day expiry.
- Uses realtime database subscriptions to update gear and checklist views.
- Supports a legacy migration from `localStorage`.

## Actual Technology Stack

| Area | Technology |
| --- | --- |
| Backend server | Go `net/http`, `html/template`, `github.com/joho/godotenv` |
| Frontend | Vanilla HTML/CSS/JavaScript, one large IIFE in `www/js/app.js` |
| Backend services | Supabase Auth, PostgREST, Storage, Realtime |
| Database | PostgreSQL through Supabase |
| Deployment | Docker image for app, self-hosted Supabase Compose stack, nginx reverse proxy |
| Static assets | Served from `www/` by Go |

## Runtime Flow

1. Browser loads `index.html` from the Go server.
2. Browser requests `/js/supabase-config.js`.
3. Go renders `www/js/supabase-config.js` as a template and injects `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. `supabase-service.js` creates the Supabase JS client.
5. `app.js` handles auth state, loads inventory, category order and storages, then renders the UI.
6. Checklist data is lazy-loaded on first checklist tab access.
7. Photos are resolved through signed URLs from the `gear-photos` bucket and cached in browser `localStorage` for about 50 minutes.

## Strengths

- Small Go server has a narrow responsibility and little business logic.
- Frontend does not require a build system.
- Supabase handles auth, database API, storage and realtime, reducing custom backend code.
- Docker and nginx production path are already represented in the repository.
- Client-side code has practical performance optimizations: lazy checklist loading, debounced realtime handling and signed URL caching.

## Main Risks And Gaps

### 1. Database migrations now own the public schema

The public application schema is now represented by ordered files in `supabase/migrations`. The legacy `public_gear_shares` model has been removed in favor of `shared_items`.

Because the browser uses `SUPABASE_ANON_KEY`, production safety still depends on Supabase-side policies, not on client-side `.eq('user_id', currentUser.id)` filters. Client filters are useful but not a security boundary.

### 2. Some runtime database objects still need migration or provisioning coverage

The client uses:

- `gear_catalog`
- `search_gear_catalog`
- Storage bucket `gear-photos`

`gear_catalog` and `search_gear_catalog` are not yet defined in `supabase/migrations`. The newer normalized catalogs `categories`, `outdoor_brands` and `outdoor_activities` do have migrations, so the remaining work is either a compatibility table/RPC for the old suggestion API or removal of the old calls from `www/js/supabase-service.js`.

`gear-photos` policies are now defined in `202607030005_subscription_visibility_access.sql`, but the repository still does not create the Storage bucket. There is also a path-contract risk to verify before rollout: the client uploads `{userId}/{itemId}.jpg`, while the current SQL policies inspect the first path segment as a gear item id.

### 3. Exported row files are snapshots, not migrations

The `sql/*_rows.sql` files are exported rows. Schema changes should be made through `supabase/migrations`; seed/import conventions are still separate work.

### 4. Frontend file size increases change risk

`www/js/app.js` contains UI rendering, form handling, category sorting, checklist workflows, photo handling, sharing, profile management and realtime orchestration in one file. This is workable for small changes, but risky for larger edits.

### 5. Operational scripts require manual secret handling

`scripts/run.sh` has the correct shape but leaves `SUPABASE_ANON_KEY` empty. Production deployment depends on manual substitution and external Supabase `.env` values.

### 6. Documentation was stale

The previous root README still described a localStorage-only static page. That no longer matches the Go/Supabase runtime.

## Recommended Next Steps

1. Resolve the old `gear_catalog` / `search_gear_catalog` contract with migrations, compatibility objects or frontend code cleanup.
2. Provision the `gear-photos` bucket reproducibly and align its Storage policies with the client upload path.
3. Split `www/js/app.js` only when touching related functionality, for example auth, checklists, inventory rendering, storage locations and sharing.
4. Add a non-secret `.env.example` and a deploy checklist with required values.
5. Add a browser smoke test for app load and signed-in inventory flow.

## Current Verification Signals

- Go server tests live in `cmd/main_test.go` and can be run with `go test ./...`.
- Frontend helper, CSP and Supabase migration contract tests live in `tests/*.mjs` and can be run with `node --test tests/*.mjs`.
- Migration tests statically verify ordered schema files, RLS/policy contracts, visible-search RPC return shape, normalized catalogs, query-path indexes and SQL visibility scenarios.
