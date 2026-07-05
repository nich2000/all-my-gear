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
