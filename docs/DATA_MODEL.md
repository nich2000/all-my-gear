# Data Model

This document describes the data contract used by the current frontend and the Supabase migrations in `supabase/migrations`.

## Tables In The Public Schema

### `gear_items`

Stores user gear inventory.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Item id. |
| `user_id` | `uuid` | Owner, references `auth.users(id)`. |
| `category` | `text` | Gear category. |
| `category_id` | `uuid` | Optional normalized category reference to `categories(id)`. |
| `name` | `text` | Required item name. |
| `brand` | `text` | Optional brand. |
| `model` | `text` | Optional model. |
| `weight` | `integer` | Weight in grams. |
| `price` | `numeric` | Price in RUB. |
| `year` | `integer` | Purchase year. |
| `rating` | `integer` | 0 to 5 satisfaction rating in the UI. |
| `image_path` | `text` | Either Storage path or legacy/base64-compatible value. |
| `order_index` | `integer` | Item ordering. |
| `comment` | `text` | User note. |
| `storage_id` | `uuid` | Optional storage location. |
| `visibility` | `text` | `public`, `private` or `shared`; defaults to `public`. |
| `published_at` | `timestamptz` | Set when the resource is public; cleared for private/shared. |
| `visibility_updated_at` | `timestamptz` | Last visibility change time. |

Client access:

- `getAllGearItems`
- `createGearItem`
- `updateGearItem`
- `deleteGearItem`
- `saveItemsOrder`
- realtime subscription on `gear_items`

Security note: RLS allows owners, public rows and explicit shared grants. Only owners can insert/update/delete.

### `checklists`

Stores trip checklists.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Checklist id. |
| `user_id` | `uuid` | Owner, references `auth.users(id)`. |
| `name` | `text` | Required checklist name. |
| `description` | `text` | Optional description, not heavily used by current client. |
| `activities` | `jsonb` | Frontend maps this to `tags`; mirrored to `checklist_activities` when values match the activity catalog. |
| `items` | `jsonb` | Checklist item snapshots/references. |
| `start_date` | `date` | Optional trip start date. |
| `end_date` | `date` | Optional trip end date. |
| `visibility` | `text` | `public`, `private` or `shared`; defaults to `public`. |
| `published_at` | `timestamptz` | Set when the checklist is public. |
| `visibility_updated_at` | `timestamptz` | Last visibility change time. |

Client access:

- `getAllChecklists`
- `createChecklist`
- `updateChecklist`
- `deleteChecklist`
- realtime subscription on `checklists`

Security note: RLS allows owners, public rows and explicit shared grants. Public checklist snapshots must not expose private item fields.

### `outdoor_activities`

Stores the global outdoor activity catalog used by checklist tag suggestions.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Activity id. |
| `name` | `text` | Stable activity name, unique. |
| `display_name` | `text` | UI label. |
| `normalized_name` | `text` | Lowercase lookup value for syncing checklist tags. |
| `display_order` | `integer` | Default ordering copied from the former frontend catalog. |
| `is_active` | `boolean` | Whether the activity is selectable/displayed. |

Client access:

- `getOutdoorActivities`

Security note: active activities are selectable by anonymous and authenticated users.

### `checklist_activities`

Stores normalized checklist-to-activity links mirrored from `checklists.activities`.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Link row id. |
| `checklist_id` | `uuid` | Checklist, references `checklists(id)` with cascade delete. |
| `activity_id` | `uuid` | Activity, references `outdoor_activities(id)` with cascade delete. |
| `activity_name` | `text` | Display name copied from `outdoor_activities` for convenient reads. |

Security note: select access follows `can_read_checklist(checklist_id)`. Inserts and deletes are owner-only; normal app writes are maintained by the `sync_checklist_activity_links` trigger.

### `categories`

Stores the global gear category catalog. The frontend loads active rows from this table for the category selector and display order fallback.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Category id. |
| `name` | `text` | Display name, unique. |
| `slug` | `text` | Stable URL/code-friendly identifier, unique. |
| `display_order` | `integer` | Default category order. |
| `is_active` | `boolean` | Whether the category is selectable/displayed. |

Client access:

- `getCategories`
- `getCategoryOrder`

Security note: active categories are selectable by anonymous and authenticated users.

### `user_category_preferences`

Stores per-user category order and sort modes using normalized category references.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Preference row id. |
| `user_id` | `uuid` | Owner, references `auth.users(id)`. |
| `category_id` | `uuid` | Category, references `categories(id)`. |
| `order_index` | `integer` | Per-user category order. |
| `sort_mode` | `text` | Per-category sort setting: `name`, `weight`, `price`, `year` or `rating`. |

Client access:

- `getCategoryOrder`
- `saveCategoryOrder`

Security note: RLS allows authenticated users to manage only their own category preferences.

### `category_order`

Legacy compatibility table for per-user category order and sort modes. New writes are mirrored here after saving `user_category_preferences`, but frontend category reads use `categories` and `user_category_preferences`.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Row id. |
| `user_id` | `uuid` | Owner. |
| `categories` | `jsonb` | Ordered category names. |
| `sort_modes` | `jsonb` | Per-category sort settings. |

Client access:

- compatibility mirror in `saveCategoryOrder`

Security note: RLS and owner-only policies are defined in the migrations.

### `storages`

Stores per-user storage locations such as garage, closet or shed.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Storage id. |
| `user_id` | `uuid` | Owner. |
| `name` | `text` | Storage display name. |
| `address` | `text` | Optional address/reference. |
| `description` | `text` | Optional notes. |
| `rating` | `integer` | 0 to 5 storage rating. |
| `visibility` | `text` | `public`, `private` or `shared`; defaults to `public`. |
| `published_at` | `timestamptz` | Set when the storage is public. |

Client access:

- `getAllStorages`
- `createStorage`
- `updateStorage`
- `deleteStorage`

Security note: RLS allows owners, public rows and explicit shared grants. Deleting a storage sets related `gear_items.storage_id` to `NULL`.

### `subscription_plans`, `user_subscriptions`, `user_entitlements`

Subscriptions control whether a user can publish private/shared resources.

- `subscription_plans` stores plan capabilities: `can_make_private` and `can_share_with_users`.
- `user_subscriptions` stores active/trialing plan membership.
- `user_entitlements` is a view consumed by the frontend through `getCurrentUserEntitlements()`.

Free users can only save `public` visibility. Subscriber entitlements allow `private` and `shared`.

### `resource_access_grants`

Stores explicit shared access.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `resource_type` | `text` | `storage`, `gear_item` or `checklist`. |
| `resource_id` | `uuid` | Resource id. |
| `owner_id` | `uuid` | Resource owner. |
| `grantee_user_id` | `uuid` | Optional target user id. |
| `grantee_email` | `text` | Optional target email. |
| `role` | `text` | Currently `viewer`. |

Client access:

- `getResourceAccessGrants`
- `grantResourceAccess`
- `revokeResourceAccess`

### Visible Search RPCs

The frontend uses RPCs for global visible search:

- `search_visible_gear(search_query, result_limit, result_offset)`
- `search_visible_checklists(search_query, result_limit, result_offset)`
- `search_visible_storages(search_query, result_limit, result_offset)`

Each RPC returns an `access_source` value: `mine`, `public` or `shared_with_me`.

### `shared_items`

Stores public share payloads for both gear items and checklists.

Important columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `uuid` | Row id. |
| `share_code` | `varchar` | Unique public code. |
| `item_id` | `uuid` | Source item id when sharing an item. |
| `checklist_id` | `uuid` | Source checklist id when sharing a checklist. |
| `owner_id` | `uuid` | Sharing user. |
| `item_data` | `jsonb` | Copied item or checklist payload. |
| `expires_at` | `timestamptz` | Link expiry. Client uses 30 days. |

Client access:

- `createShareLink`
- `getSharedItem`
- `saveSharedItem`
- `createChecklistShare`
- `getSharedChecklist`

Security note: owners can manage their shares, and anonymous users can read non-expired share rows. `item_id` and `checklist_id` are mutually exclusive and cascade-delete share rows when the source object is deleted.

## Runtime Objects Not Yet Defined By Migrations

The frontend also depends on:

| Object | Used by | Required behavior |
| --- | --- | --- |
| `gear_catalog` table/view | brand/model suggestions | Selectable by authenticated or anonymous users depending on product policy. |
| `search_gear_catalog` RPC | search suggestions | Returns catalog matches for query, brand and limit. |
| `gear-photos` Storage bucket | item/avatar photos | Upload/remove by owner, signed URL read for allowed objects. |

These objects should be added to migrations or documented as manually provisioned infrastructure.

## Browser Local Storage Keys

Current/legacy keys observed in the client:

| Key | Purpose |
| --- | --- |
| `allmygear.items` | Legacy local inventory data for migration. |
| `allmygear.checklists` | Legacy checklist data for migration/fallback paths. |
| `allmygear.categoryOrder` | Legacy category order. |
| `allmygear.photoUrlsCache` | Signed photo URL cache. |
| `allmygear.photoUrlsCacheTime` | Signed URL cache timestamp. |

## Required Policy Checklist

Before production changes, verify these Supabase policies directly in the live project:

- `gear_items`: users can select rows they own, public rows and rows shared with them; only owners can mutate.
- `checklists`: users can select rows they own, public rows and rows shared with them; only owners can mutate.
- `category_order`: authenticated users can select/insert/update/delete only their own rows.
- `storages`: users can select rows they own, public rows and rows shared with them; only owners can mutate.
- `shared_items`: owners can create shares; anonymous users can read non-expired public share rows; expired shares should not expose data.
- `gear-photos`: users can upload/remove only their own paths; read behavior must match share-link requirements.
