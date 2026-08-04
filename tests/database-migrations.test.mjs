import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const visibilityChecksFile = new URL('../supabase/tests/visibility_access_checks.sql', import.meta.url)

function readMigrations() {
  assert.equal(existsSync(migrationsDir), true, 'supabase/migrations must exist')

  const files = readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort()

  assert.ok(files.length > 0, 'at least one SQL migration is required')

  return files.map(name => ({
    name,
    sql: readFileSync(join(migrationsDir.pathname, name), 'utf8')
  }))
}

function compact(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase()
}

test('database migrations define the live schema without the legacy share table', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.equal(allSql.includes('create table public.public_gear_shares'), false)
  assert.equal(allSql.includes('insert into "public"."public_gear_shares"'), false)
  assert.ok(allSql.includes('drop table if exists public.public_gear_shares'))

  assert.ok(allSql.includes('create table if not exists public.storages'))
  assert.ok(allSql.includes('create table if not exists public.gear_items'))
  assert.ok(allSql.indexOf('create table if not exists public.storages') < allSql.indexOf('create table if not exists public.gear_items'))
})

test('storage deletion and public shares are enforced by database constraints', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.match(allSql, /foreign key \(storage_id\) references public\.storages\(id\) on delete set null/)
  assert.match(allSql, /constraint check_item_or_checklist check \(\(item_id is not null\) <> \(checklist_id is not null\)\)/)
  assert.match(allSql, /foreign key \(item_id\) references public\.gear_items\(id\) on delete cascade/)
  assert.match(allSql, /foreign key \(checklist_id\) references public\.checklists\(id\) on delete cascade/)
})

test('owner update policies keep reassigned rows within the current user', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  for (const table of ['storages', 'gear_items', 'checklists', 'category_order']) {
    assert.match(
      allSql,
      new RegExp(`on public\\.${table} for update using \\(auth\\.uid\\(\\) = user_id\\) with check \\(auth\\.uid\\(\\) = user_id\\)`)
    )
  }

  assert.match(
    allSql,
    /on public\.shared_items for update to authenticated using \(auth\.uid\(\) = owner_id\) with check \(auth\.uid\(\) = owner_id\)/
  )
})

test('database migrations preserve the repaired MSR Quick 2 System image path', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes("update public.gear_items set image_path = 'a8cf0468-ac26-4897-97a1-68fbac9d5364/c4cbb0f8-8ab3-42f7-871e-e5f43579b174.jpg'"))
  assert.ok(allSql.includes("id = 'c4cbb0f8-8ab3-42f7-871e-e5f43579b174'"))
  assert.ok(allSql.includes("name = 'набор посуды'"))
  assert.ok(allSql.includes("brand = 'msr'"))
  assert.ok(allSql.includes("model = 'quick 2 system'"))
})

test('database migrations are safe to apply to an existing production schema', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.equal(allSql.includes('create policy "'), false, 'policies must be recreated through idempotent blocks')

  for (const [table, columns] of Object.entries({
    gear_items: ['order_index', 'comment', 'storage_id'],
    checklists: ['start_date', 'end_date'],
    shared_items: ['item_id', 'checklist_id']
  })) {
    for (const column of columns) {
      assert.ok(
        allSql.includes(`alter table if exists public.${table} add column if not exists ${column}`),
        `${table}.${column} must be added idempotently for existing databases`
      )
    }
  }

  assert.match(allSql, /drop policy if exists "users can update their own gear items" on public\.gear_items/)
  assert.match(allSql, /drop policy if exists "anyone can read non-expired public shares" on public\.shared_items/)
})

test('visibility access policies are recreated idempotently', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607030005_subscription_visibility_access.sql')
  assert.ok(migration, 'subscription visibility migration must exist')

  const sql = compact(migration.sql)
  for (const policy of [
    'storages_select_visible',
    'storages_insert_owner_with_entitlement',
    'storages_update_owner_with_entitlement',
    'storages_delete_owner',
    'gear_items_select_visible',
    'gear_items_insert_owner_with_entitlement',
    'gear_items_update_owner_with_entitlement',
    'gear_items_delete_owner',
    'checklists_select_visible',
    'checklists_insert_owner_with_entitlement',
    'checklists_update_owner_with_entitlement',
    'checklists_delete_owner'
  ]) {
    assert.ok(sql.includes(`drop policy if exists ${policy}`), `${policy} must be dropped before recreate`)
    assert.ok(sql.includes(`create policy ${policy}`), `${policy} must be recreated`)
    assert.ok(sql.indexOf(`drop policy if exists ${policy}`) < sql.indexOf(`create policy ${policy}`))
  }
})

test('visible gear search function can be recreated after later contract migrations', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607030005_subscription_visibility_access.sql')
  assert.ok(migration, 'subscription visibility migration must exist')

  const sql = compact(migration.sql)
  assert.ok(sql.includes('drop function if exists public.search_visible_gear(text, int, int)'))
  assert.ok(
    sql.indexOf('drop function if exists public.search_visible_gear(text, int, int)') <
      sql.indexOf('create or replace function public.search_visible_gear(search_query text, result_limit int, result_offset int)'),
    'search_visible_gear must be dropped before recreating because later migrations change its return row type'
  )
})

test('database migrations define visibility, entitlements, grants and visible search RPCs', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  for (const table of ['gear_items', 'checklists', 'storages']) {
    assert.ok(allSql.includes(`alter table if exists public.${table} add column if not exists visibility`))
    assert.ok(allSql.includes(`alter table if exists public.${table} add column if not exists published_at`))
    assert.match(allSql, new RegExp(`create index if not exists idx_${table}_visibility`))
  }

  assert.ok(allSql.includes('create or replace view public.user_entitlements'))
  assert.ok(allSql.includes('create table if not exists public.resource_access_grants'))
  assert.ok(allSql.includes('create or replace function public.search_visible_gear'))
  assert.ok(allSql.includes('create or replace function public.search_visible_checklists'))
  assert.ok(allSql.includes('create or replace function public.search_visible_storages'))
  assert.ok(allSql.includes('access_source'))
  assert.match(allSql, /on public\.resource_access_grants for select/)
})

test('database migrations add subscription entitlements and durable visibility controls', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes('create table if not exists public.subscription_plans'))
  assert.ok(allSql.includes('create table if not exists public.user_subscriptions'))
  assert.ok(allSql.includes('create or replace view public.user_entitlements'))
  assert.ok(allSql.includes('create or replace function public.can_use_private_visibility(user_id uuid)'))

  for (const entitlement of ['can_make_private', 'can_share_with_users']) {
    assert.ok(allSql.includes(entitlement), `${entitlement} entitlement must be modeled`)
  }

  for (const table of ['storages', 'gear_items', 'checklists']) {
    assert.ok(allSql.includes(`alter table if exists public.${table} add column if not exists visibility text not null default 'public'`))
    assert.ok(allSql.includes(`alter table if exists public.${table} add column if not exists visibility_updated_at timestamptz`))
    assert.ok(allSql.includes(`alter table if exists public.${table} add column if not exists published_at timestamptz`))
    assert.match(allSql, new RegExp(`alter table if exists public\\.${table} add constraint ${table}_visibility_check check \\(visibility in \\('public', 'private', 'shared'\\)\\)`))
  }

  assert.ok(allSql.includes('create table if not exists public.resource_access_grants'))
  assert.match(allSql, /resource_type text not null/)
  assert.match(allSql, /constraint resource_access_grants_resource_type_check check \(resource_type in \('storage', 'gear_item', 'checklist'\)\)/)
  assert.match(allSql, /constraint resource_access_grants_role_check check \(role = 'viewer'\)/)
})

test('collaborative visibility migration adds editor roles and directional sharing', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607230001_collaborative_visibility_access.sql')
  assert.ok(migration, 'collaborative visibility migration must exist')

  const sql = compact(migration.sql)
  for (const entitlement of [
    'can_grant_edit',
    'max_shared_users',
    'max_editors',
    'max_active_share_links'
  ]) {
    assert.ok(sql.includes(entitlement), `${entitlement} entitlement must be modeled`)
  }

  assert.ok(sql.includes("check (role in ('viewer', 'editor'))"))
  assert.ok(sql.includes('create unique index if not exists uq_resource_access_grants_user'))
  assert.ok(sql.includes('create unique index if not exists uq_resource_access_grants_email'))
  assert.ok(sql.includes('create or replace function public.can_edit_gear_item'))
  assert.ok(sql.includes('create or replace function public.can_edit_checklist'))
  assert.ok(sql.includes('create or replace function public.configure_resource_access'))
  assert.ok(sql.includes('create or replace function public.get_resource_access_settings'))
  assert.ok(sql.includes('create or replace function public.revoke_temporary_share_link'))
  assert.ok(sql.includes("'shared_by_me'"))
  assert.ok(sql.includes("'shared_with_me'"))
  assert.match(sql, /create policy gear_items_update_owner_or_editor/)
  assert.match(sql, /create policy checklists_update_owner_or_editor/)
  assert.match(sql, /editors cannot change ownership or access settings/)
  assert.match(sql, /on storage\.objects for select to anon, authenticated/)
})

test('visibility API grants expose RLS-managed resources to PostgREST roles', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607230002_visibility_api_privileges.sql')
  assert.ok(migration, 'visibility API privilege migration must exist')

  const sql = compact(migration.sql)
  assert.ok(sql.includes('grant usage on schema public to anon, authenticated'))
  assert.ok(sql.includes('grant select on table public.gear_items to anon, authenticated'))
  assert.ok(sql.includes('grant select on table public.checklists to anon, authenticated'))
  assert.ok(sql.includes('grant insert, update, delete on table public.gear_items to authenticated'))
  assert.ok(sql.includes('grant insert, update, delete on table public.checklists to authenticated'))
  assert.ok(sql.includes('grant select, insert, update, delete on table public.resource_access_grants to authenticated'))
  assert.ok(sql.includes('grant execute on function public.search_visible_gear(text, integer, integer, text) to anon, authenticated'))

  const authMigration = migrations.find(({ name }) => name === '202607230003_auth_helper_privileges.sql')
  assert.ok(authMigration, 'auth helper privilege migration must exist')
  const authSql = compact(authMigration.sql)
  assert.ok(authSql.includes('grant usage on schema auth to anon, authenticated'))
  assert.ok(authSql.includes('grant execute on function auth.uid() to anon, authenticated'))
  assert.ok(authSql.includes('grant execute on function auth.jwt() to anon, authenticated'))

  const appMigration = migrations.find(({ name }) => name === '202607230004_app_api_privileges.sql')
  assert.ok(appMigration, 'app API privilege migration must exist')
  const appSql = compact(appMigration.sql)
  for (const catalog of ['categories', 'outdoor_brands', 'outdoor_activities']) {
    assert.ok(appSql.includes(`grant select on table public.${catalog} to anon, authenticated`))
  }
  assert.ok(appSql.includes('grant select, insert, update, delete on table public.category_order to authenticated'))
  assert.ok(appSql.includes('grant select, insert, update, delete on table public.user_category_preferences to authenticated'))
})

test('subscription entitlement tables and view satisfy Supabase public schema security lint', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.match(allSql, /create or replace view public\.user_entitlements with \(security_invoker = true\) as/)

  for (const table of ['subscription_plans', 'user_subscriptions']) {
    assert.ok(
      allSql.includes(`alter table public.${table} enable row level security`),
      `${table} must enable RLS because public schema is exposed through PostgREST`
    )
  }

  assert.match(allSql, /create policy subscription_plans_select_all on public\.subscription_plans for select to anon, authenticated/)
  assert.match(allSql, /create policy user_subscriptions_select_owner on public\.user_subscriptions for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/)
})

test('database migrations resolve Supabase auth RLS initPlan lint for active policies', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607050004_fix_auth_rls_initplan_policies.sql')
  assert.ok(migration, 'auth RLS initPlan fix migration must exist')

  const sql = compact(migration.sql)
  const expectedPolicies = [
    'users_can_view_own_category_order',
    'users_can_insert_own_category_order',
    'users_can_update_own_category_order',
    'users_can_delete_own_category_order',
    'users_can_view_own_shared_items',
    'users_can_insert_own_shared_items',
    'users_can_update_own_shared_items',
    'users_can_delete_own_shared_items',
    'anyone_can_read_non_expired_public_shares',
    'resource_access_grants_select_related',
    'resource_access_grants_insert_owner_with_entitlement',
    'resource_access_grants_update_owner_with_entitlement',
    'resource_access_grants_delete_owner',
    'storages_insert_owner_with_entitlement',
    'storages_update_owner_with_entitlement',
    'storages_delete_owner',
    'gear_items_insert_owner_with_entitlement',
    'gear_items_update_owner_with_entitlement',
    'gear_items_delete_owner',
    'checklists_insert_owner_with_entitlement',
    'checklists_update_owner_with_entitlement',
    'checklists_delete_owner',
    'user_category_preferences_select_owner',
    'user_category_preferences_insert_owner',
    'user_category_preferences_update_owner',
    'user_category_preferences_delete_owner',
    'checklist_activities_insert_owner',
    'checklist_activities_delete_owner',
    'user_subscriptions_select_owner'
  ]

  for (const policy of expectedPolicies) {
    assert.ok(sql.includes(`drop policy if exists ${policy}`), `${policy} must be dropped before recreate`)
    assert.ok(sql.includes(`create policy ${policy}`), `${policy} must be recreated`)
    assert.ok(sql.indexOf(`drop policy if exists ${policy}`) < sql.indexOf(`create policy ${policy}`))
  }

  assert.equal(sql.includes('using (auth.uid()'), false, 'RLS using clauses must not call auth.uid() directly')
  assert.equal(sql.includes('with check (auth.uid()'), false, 'RLS check clauses must not call auth.uid() directly')
  assert.equal(sql.includes(' and auth.uid()'), false, 'RLS boolean expressions must not call auth.uid() directly')
  assert.equal(sql.includes(' or auth.uid()'), false, 'RLS boolean expressions must not call auth.uid() directly')
  assert.doesNotMatch(sql, /lower\(auth\.jwt\(\)/, 'RLS policies must use (select auth.jwt()) initPlan form')
  assert.ok(sql.includes('(select auth.uid())'))
  assert.ok(sql.includes("(select auth.jwt()) ->> 'email'"))
  assert.match(sql, /create policy users_can_view_own_shared_items on public\.shared_items for select to authenticated using \(\s*\(select auth\.uid\(\)\) = owner_id\s*or expires_at > now\(\)\s*\)/)
  assert.match(sql, /create policy anyone_can_read_non_expired_public_shares on public\.shared_items for select to anon using \(expires_at > now\(\)\)/)
})

test('catalog trigger functions and search extension satisfy Supabase security lint', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  for (const functionName of ['sync_gear_item_category_id', 'sync_gear_item_brand_id']) {
    assert.match(
      allSql,
      new RegExp(`create or replace function public\\.${functionName}\\(\\) returns trigger language plpgsql set search_path = public as`)
    )
    assert.ok(
      allSql.includes(`alter function public.${functionName}() set search_path = public`),
      `${functionName} must be hardened for existing databases`
    )
  }

  assert.ok(allSql.includes('create schema if not exists extensions'))
  assert.ok(allSql.includes('create extension if not exists pg_trgm with schema extensions'))
  assert.ok(allSql.includes('alter extension pg_trgm set schema extensions'))
  assert.equal(allSql.includes('create extension if not exists pg_trgm;'), false)
})

test('database migrations add access functions, search RPCs, storage stats, and hardened RLS', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  for (const functionName of [
    'can_read_storage(storage_id uuid)',
    'can_read_gear_item(item_id uuid)',
    'can_read_checklist(checklist_id uuid)',
    'can_update_resource_visibility(resource_type text, resource_id uuid, next_visibility text)',
    'search_visible_gear(search_query text, result_limit int, result_offset int)',
    'search_visible_checklists(search_query text, result_limit int, result_offset int)',
    'search_visible_storages(search_query text, result_limit int, result_offset int)'
  ]) {
    assert.ok(allSql.includes(`create or replace function public.${functionName}`), `${functionName} must be created`)
  }

  assert.ok(allSql.includes('create or replace view public.storage_stats'))
  assert.equal(allSql.includes('items_count'), false, 'storages must not persist manual item counts')

  for (const table of ['storages', 'gear_items', 'checklists']) {
    assert.match(allSql, new RegExp(`create policy ${table}_select_visible on public\\.${table} for select to anon, authenticated`))
    assert.match(allSql, new RegExp(`create policy ${table}_insert_owner_with_entitlement on public\\.${table} for insert to authenticated`))
    assert.match(allSql, new RegExp(`create policy ${table}_update_owner_with_entitlement on public\\.${table} for update to authenticated`))
    assert.match(allSql, new RegExp(`create policy ${table}_delete_owner on public\\.${table} for delete to authenticated`))
  }

  assert.ok(allSql.includes("case when user_id = auth.uid() then 'mine' when visibility = 'public' then 'public' else 'shared_with_me' end as access_source"))
  assert.ok(allSql.includes('bucket_id = \'gear-photos\''))
  assert.ok(allSql.includes('public.can_read_gear_item'))
})

test('visible gear search RPC returns the full card data contract', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607050001_fix_visible_gear_card_contract.sql')
  assert.ok(migration, 'visible gear card contract fix migration must exist')
  const sql = compact(migration.sql)
  assert.ok(sql.includes('drop function if exists public.search_visible_gear(text, int, int)'))
  assert.ok(
    sql.indexOf('drop function if exists public.search_visible_gear(text, int, int)') <
      sql.indexOf('create function public.search_visible_gear(search_query text, result_limit int, result_offset int)'),
    'search_visible_gear must be dropped before recreating with a new return type'
  )

  for (const field of [
    'user_id uuid',
    'weight integer',
    'price numeric',
    'year integer',
    'rating integer',
    'comment text',
    'storage_id uuid',
    'created_at timestamptz',
    'updated_at timestamptz',
    'order_index integer',
    'published_at timestamptz'
  ]) {
    assert.ok(sql.includes(field), `search_visible_gear must return ${field}`)
  }

  for (const selectedColumn of [
    'gi.user_id',
    'gi.weight',
    'gi.price',
    'gi.year',
    'gi.rating',
    'gi.comment',
    'gi.storage_id',
    'gi.created_at',
    'gi.updated_at',
    'gi.order_index',
    'gi.published_at'
  ]) {
    assert.ok(sql.includes(selectedColumn), `search_visible_gear must select ${selectedColumn}`)
  }
})

test('database migrations normalize gear categories and user sort preferences', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes('create table if not exists public.categories'))
  assert.ok(allSql.includes('create table if not exists public.user_category_preferences'))
  assert.ok(allSql.includes('alter table if exists public.gear_items add column if not exists category_id uuid'))
  assert.match(allSql, /foreign key \(category_id\) references public\.categories\(id\)/)
  assert.match(allSql, /foreign key \(category_id\) references public\.categories\(id\) on delete cascade/)
  assert.match(allSql, /constraint user_category_preferences_user_category_key unique \(user_id, category_id\)/)

  for (const category of [
    'Shelter',
    'Sleep System',
    'Fishing & Hunting',
    'Climbing & Rope',
    'Winter & Snow',
    'Photo/Video Gear',
    'Ride Gear',
    'Consumables'
  ]) {
    assert.ok(allSql.includes(`'${category.toLowerCase()}'`), `${category} must be seeded in categories`)
  }

  assert.ok(allSql.includes('insert into public.user_category_preferences'))
  assert.ok(allSql.includes('from public.category_order co'))
  assert.ok(allSql.includes('jsonb_array_elements_text(co.categories) with ordinality'))
  assert.ok(allSql.includes('co.sort_modes ->> category_name'))
  assert.ok(allSql.includes('create or replace function public.sync_gear_item_category_id()'))
  assert.ok(allSql.includes('create trigger sync_gear_item_category_id_trigger'))
  assert.ok(allSql.includes('before insert or update of category, category_id on public.gear_items'))
  assert.ok(allSql.includes("when lower(trim(new.category)) = 'kitchen' then 'cooking'"))
  assert.ok(allSql.includes("when new.category = 'bag / package' then 'packs & bags'"))
  assert.match(allSql, /create policy user_category_preferences_select_owner/)
  assert.match(allSql, /create policy categories_select_all/)
})

test('database migrations normalize outdoor brands and link gear items to the brand catalog', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes('create table if not exists public.outdoor_brands'))
  assert.ok(allSql.includes('alter table if exists public.gear_items add column if not exists brand_id uuid'))
  assert.match(allSql, /foreign key \(brand_id\) references public\.outdoor_brands\(id\)/)
  assert.ok(allSql.includes('create index if not exists idx_outdoor_brands_display_name'))
  assert.ok(allSql.includes('create index if not exists idx_gear_items_brand_id'))
  assert.ok(allSql.includes('create or replace function public.sync_gear_item_brand_id()'))
  assert.ok(allSql.includes('create trigger sync_gear_item_brand_id_trigger'))
  assert.ok(allSql.includes('before insert or update of brand, brand_id on public.gear_items'))
  assert.match(allSql, /create policy outdoor_brands_select_all/)

  for (const brand of [
    "Arc'teryx",
    'MSR',
    'Patagonia',
    'Ortlieb',
    'Сплав',
    'Наша Марка'
  ]) {
    assert.ok(allSql.includes(`'${brand.toLowerCase().replaceAll("'", "''")}'`), `${brand} must be seeded in outdoor_brands`)
  }
})

test('database migrations normalize outdoor activities and link checklists to the activity catalog', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes('create table if not exists public.outdoor_activities'))
  assert.ok(allSql.includes('create table if not exists public.checklist_activities'))
  assert.match(allSql, /foreign key \(checklist_id\) references public\.checklists\(id\) on delete cascade/)
  assert.match(allSql, /foreign key \(activity_id\) references public\.outdoor_activities\(id\) on delete cascade/)
  assert.match(allSql, /constraint checklist_activities_checklist_activity_key unique \(checklist_id, activity_id\)/)
  assert.ok(allSql.includes('create index if not exists idx_outdoor_activities_display_name'))
  assert.ok(allSql.includes('create index if not exists idx_checklist_activities_checklist_id'))
  assert.ok(allSql.includes('create or replace function public.sync_checklist_activity_links()'))
  assert.ok(allSql.includes('create trigger sync_checklist_activity_links_trigger'))
  assert.ok(allSql.includes('after insert or update of activities on public.checklists'))
  assert.match(allSql, /create policy outdoor_activities_select_all/)
  assert.match(allSql, /create policy checklist_activities_select_visible_checklist/)

  for (const activity of [
    'Day Hiking',
    'Backpacking',
    'Stand-up Paddleboarding (SUP)',
    'Spearfishing',
    'Scientific Expedition'
  ]) {
    assert.ok(allSql.includes(`'${activity.toLowerCase().replaceAll("'", "''")}'`), `${activity} must be seeded in outdoor_activities`)
  }
})

test('database migrations add query-path indexes for Supabase reads and visible search', () => {
  const migrations = readMigrations()
  const allSql = compact(migrations.map(migration => migration.sql).join('\n'))

  assert.ok(allSql.includes('create extension if not exists pg_trgm'), 'visible search requires pg_trgm indexes')

  for (const expectedIndex of [
    'create index if not exists idx_gear_items_user_category_order_created on public.gear_items(user_id, category, order_index, created_at desc)',
    'create index if not exists idx_checklists_user_created_at on public.checklists(user_id, created_at desc)',
    'create index if not exists idx_storages_user_name on public.storages(user_id, name)',
    'create index if not exists idx_user_category_preferences_user_order on public.user_category_preferences(user_id, order_index)',
    'create index if not exists idx_resource_access_grants_owner_resource_created on public.resource_access_grants(owner_id, resource_type, resource_id, created_at)',
    'create index if not exists idx_outdoor_brands_active_display_name on public.outdoor_brands(is_active, display_name)',
    'create index if not exists idx_outdoor_activities_active_display_name on public.outdoor_activities(is_active, display_name)',
    'create index if not exists idx_categories_active_display_order on public.categories(is_active, display_order)'
  ]) {
    assert.ok(allSql.includes(expectedIndex), `${expectedIndex} must exist`)
  }

  for (const expectedIndex of [
    'idx_gear_items_visible_search_trgm',
    'idx_checklists_visible_search_trgm',
    'idx_storages_visible_search_trgm'
  ]) {
    assert.ok(allSql.includes(expectedIndex), `${expectedIndex} must exist`)
    assert.match(allSql, new RegExp(`${expectedIndex}.*using gin.*gin_trgm_ops`))
  }
})

test('database migrations cover foreign keys flagged by Supabase lint', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607050005_add_fk_covering_indexes.sql')
  assert.ok(migration, 'foreign-key covering index migration must exist')

  const sql = compact(migration.sql)
  for (const expectedIndex of [
    'create index if not exists idx_shared_items_item_id on public.shared_items(item_id)',
    'create index if not exists idx_shared_items_checklist_id on public.shared_items(checklist_id)',
    'create index if not exists idx_user_subscriptions_plan_id on public.user_subscriptions(plan_id)'
  ]) {
    assert.ok(sql.includes(expectedIndex), `${expectedIndex} must exist`)
  }
})

test('database migrations grant storage api role access to storage schema tables', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607050008_grant_storage_api_schema_access.sql')
  assert.ok(migration, 'storage api grant migration must exist')

  const sql = compact(migration.sql)
  assert.ok(sql.includes('grant usage on schema storage to supabase_storage_admin'))
  assert.ok(sql.includes('grant all privileges on all tables in schema storage to supabase_storage_admin'))
  assert.ok(sql.includes('grant all privileges on all sequences in schema storage to supabase_storage_admin'))
  assert.ok(sql.includes('alter role service_role set search_path = storage, public, extensions'))
  assert.ok(sql.includes('grant usage on schema storage to service_role'))
  assert.ok(sql.includes('grant all privileges on all tables in schema storage to service_role'))
  assert.ok(sql.includes('grant all privileges on all sequences in schema storage to service_role'))
  assert.ok(sql.includes('create policy storage_migrations_admin_all on storage.migrations for all to supabase_storage_admin'))
})

test('database migrations normalize shared item image snapshots to storage paths', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607050009_normalize_shared_item_image_paths.sql')
  assert.ok(migration, 'shared item image path migration must exist')

  const sql = compact(migration.sql)
  assert.ok(sql.includes('update public.shared_items si'))
  assert.ok(sql.includes("set item_data = jsonb_set(si.item_data, '{image_path}', to_jsonb(gi.image_path), true)"))
  assert.ok(sql.includes('from public.gear_items gi'))
  assert.ok(sql.includes('where si.item_id = gi.id'))
  assert.ok(sql.includes("jsonb_array_elements(si.item_data->'items') with ordinality"))
  assert.ok(sql.includes("left join public.gear_items gi on gi.id = (item.value->>'id')::uuid"))
  assert.ok(sql.includes('order by item.ordinality'))
  assert.ok(sql.includes("coalesce(item.value->>'image_path', '') <> gi.image_path"))
})

test('database migrations model applied migration state separately from app data', () => {
  const migrations = readMigrations()
  const createMigration = migrations.find(({ name }) => name === '202607050006_create_schema_migrations.sql')
  assert.ok(createMigration, 'schema migration model migration must exist')

  const sql = compact(createMigration.sql)
  assert.ok(sql.includes('create table if not exists public.schema_migrations'))
  assert.ok(sql.includes('filename text primary key'))
  assert.ok(sql.includes('checksum_sha256 text not null'))
  assert.ok(sql.includes('applied_at timestamptz not null default now()'))
  assert.ok(sql.includes('source text not null default'))
  assert.ok(sql.includes('alter table public.schema_migrations enable row level security'))
  assert.ok(sql.includes('revoke all on public.schema_migrations from anon, authenticated'))
})

test('database migrations backfill already installed migration records in a separate migration', () => {
  const migrations = readMigrations()
  const backfillMigration = migrations.find(({ name }) => name === '202607050007_record_existing_schema_migrations.sql')
  assert.ok(backfillMigration, 'installed migration backfill migration must exist')

  const sql = compact(backfillMigration.sql)
  const expectedExistingMigrations = migrations
    .map(({ name }) => name)
    .filter(name => name < '202607050007_record_existing_schema_migrations.sql')

  assert.ok(sql.includes('insert into public.schema_migrations (filename, checksum_sha256, source)'))
  assert.ok(sql.includes("on conflict (filename) do nothing"))

  for (const name of expectedExistingMigrations) {
    assert.ok(sql.includes(`'${name}'`), `${name} must be recorded as already installed`)
  }
})

test('database migrations contain SQL access scenario checks', () => {
  const migrations = readMigrations()
  assert.equal(existsSync(visibilityChecksFile), true, 'visibility access SQL checks must exist')

  const allSql = compact([
    ...migrations.map(migration => migration.sql),
    readFileSync(visibilityChecksFile, 'utf8')
  ].join('\n'))

  for (const scenario of [
    'anon sees public',
    'anon cannot see private or shared',
    'other user sees public',
    'grantee sees shared',
    'free user cannot make private',
    'subscriber can make private'
  ]) {
    assert.ok(allSql.includes(scenario), `missing SQL check scenario: ${scenario}`)
  }
})

test('resource SELECT policies allow owner INSERT RETURNING without recursive lookup', () => {
  const migrations = readMigrations()
  const migration = migrations.find(
    ({ name }) => name === '202607230005_fix_resource_insert_returning_rls.sql'
  )
  assert.ok(migration, 'INSERT RETURNING RLS fix migration must exist')

  const sql = compact(migration.sql)
  assert.ok(sql.includes('user_id = (select auth.uid())'))
  assert.ok(sql.includes("visibility = 'public'"))
  assert.ok(sql.includes('public.can_read_gear_item(id)'))
  assert.ok(sql.includes('public.can_read_checklist(id)'))
})

test('admin migration defines the least-privilege role matrix and protected RPC boundary', () => {
  const migrations = readMigrations()
  const migration = migrations.find(({ name }) => name === '202607270001_admin_roles_and_api.sql')
  assert.ok(migration, 'admin role migration must exist')

  const sql = compact(migration.sql)
  for (const table of ['app_roles', 'app_permissions', 'app_role_permissions', 'app_user_roles']) {
    assert.ok(sql.includes(`create table if not exists public.${table}`), `${table} must be created`)
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS`)
  }

  for (const role of ['user', 'admin', 'superadmin']) {
    assert.ok(sql.includes(`('${role}'`), `${role} role must be seeded`)
  }

  assert.ok(sql.includes("perform public.require_app_permission('users.read')"))
  assert.ok(sql.includes("perform public.require_app_permission('catalogs.update')"))
  assert.ok(sql.includes("perform public.require_app_permission('roles.update')"))
  assert.ok(sql.includes("perform public.require_app_permission('subscriptions.update')"))
  assert.ok(sql.includes('a superadmin cannot remove their own superadmin role'))
  assert.ok(sql.includes('administrative roles must retain admin.access'))

  for (const email of [
    'nich2000@mail.ru',
    'ili.gurevich@gmail.com',
    'nikolai.svistoun@gmail.com'
  ]) {
    assert.ok(sql.includes(`'${email}'`), `${email} must be bootstrapped as superadmin`)
  }
})

test('the user interface has no links or buttons that expose the admin route', () => {
  const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8').toLowerCase()
  assert.equal(indexHtml.includes('href="/admin'), false)
  assert.equal(indexHtml.includes("href='/admin"), false)
  assert.equal(indexHtml.includes('data-route="admin'), false)
  assert.equal(indexHtml.includes('id="admin'), false)
})
