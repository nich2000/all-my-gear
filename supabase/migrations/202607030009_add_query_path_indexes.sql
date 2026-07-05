-- Add indexes for the current Supabase read paths and visible-search RPCs.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
alter extension pg_trgm set schema extensions;
set search_path = public, extensions;

create index if not exists idx_gear_items_user_category_order_created
  on public.gear_items(user_id, category, order_index, created_at desc);

create index if not exists idx_checklists_user_created_at
  on public.checklists(user_id, created_at desc);

create index if not exists idx_storages_user_name
  on public.storages(user_id, name);

create index if not exists idx_user_category_preferences_user_order
  on public.user_category_preferences(user_id, order_index);

create index if not exists idx_resource_access_grants_owner_resource_created
  on public.resource_access_grants(owner_id, resource_type, resource_id, created_at);

create index if not exists idx_categories_active_display_order
  on public.categories(is_active, display_order);

do $$
begin
  if to_regclass('public.outdoor_brands') is not null then
    execute 'create index if not exists idx_outdoor_brands_active_display_name on public.outdoor_brands(is_active, display_name)';
  end if;

  if to_regclass('public.outdoor_activities') is not null then
    execute 'create index if not exists idx_outdoor_activities_active_display_name on public.outdoor_activities(is_active, display_name)';
  end if;
end $$;

create index if not exists idx_gear_items_visible_search_trgm
  on public.gear_items using gin (
    name gin_trgm_ops,
    category gin_trgm_ops,
    brand gin_trgm_ops,
    model gin_trgm_ops
  );

create index if not exists idx_checklists_visible_search_trgm
  on public.checklists using gin (
    name gin_trgm_ops,
    description gin_trgm_ops
  );

create index if not exists idx_storages_visible_search_trgm
  on public.storages using gin (
    name gin_trgm_ops,
    description gin_trgm_ops,
    address gin_trgm_ops
  );
