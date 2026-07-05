-- Move gear categories from frontend constants into normalized database entities.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  display_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint categories_name_key unique (name),
  constraint categories_slug_key unique (slug),
  constraint categories_display_order_key unique (display_order)
);

comment on table public.categories is 'Global gear category catalog used by inventory items and per-user ordering preferences';

insert into public.categories (name, slug, display_order)
values
  ('Shelter', 'shelter', 0),
  ('Sleep System', 'sleep-system', 1),
  ('Camp Furniture', 'camp-furniture', 2),
  ('Clothing', 'clothing', 3),
  ('Footwear', 'footwear', 4),
  ('Packs & Bags', 'packs-bags', 5),
  ('Cooking', 'cooking', 6),
  ('Electronics', 'electronics', 7),
  ('Lighting', 'lighting', 8),
  ('First Aid / Safety', 'first-aid-safety', 9),
  ('Personal items / Documents', 'personal-items-documents', 10),
  ('Knives & Tools', 'knives-tools', 11),
  ('Technical Gear', 'technical-gear', 12),
  ('Sports Equipment', 'sports-equipment', 13),
  ('Fishing & Hunting', 'fishing-hunting', 14),
  ('Climbing & Rope', 'climbing-rope', 15),
  ('Winter & Snow', 'winter-snow', 16),
  ('Photo/Video Gear', 'photo-video-gear', 17),
  ('Ride Gear', 'ride-gear', 18),
  ('Consumables', 'consumables', 19)
on conflict (name) do update
set
  slug = excluded.slug,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();

create table if not exists public.user_category_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category_id uuid not null,
  order_index integer not null default 0,
  sort_mode text not null default 'name',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint user_category_preferences_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint user_category_preferences_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete cascade,
  constraint user_category_preferences_user_category_key unique (user_id, category_id),
  constraint user_category_preferences_sort_mode_check check (sort_mode in ('name', 'weight', 'price', 'year', 'rating'))
);

comment on table public.user_category_preferences is 'Per-user category order and per-category sort mode';

alter table if exists public.gear_items
  add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gear_items_category_id_fkey'
      and conrelid = 'public.gear_items'::regclass
  ) then
    alter table public.gear_items
      add constraint gear_items_category_id_fkey
      foreign key (category_id) references public.categories(id);
  end if;
end $$;

create index if not exists idx_categories_display_order on public.categories(display_order);
create index if not exists idx_gear_items_category_id on public.gear_items(category_id);
create index if not exists idx_user_category_preferences_user_id on public.user_category_preferences(user_id);
create index if not exists idx_user_category_preferences_category_id on public.user_category_preferences(category_id);

update public.gear_items gi
set
  category = c.name,
  category_id = c.id
from public.categories c
where c.name = case
    when trim(coalesce(gi.category, '')) = '' then null
    when lower(trim(gi.category)) = 'kitchen' then 'Cooking'
    when gi.category = 'Bag / Package' then 'Packs & Bags'
    else trim(gi.category)
  end
  and (gi.category_id is distinct from c.id or gi.category is distinct from c.name);

insert into public.user_category_preferences (user_id, category_id, order_index, sort_mode)
select
  co.user_id,
  c.id,
  category_ord.ordinality::integer - 1,
  coalesce(nullif(co.sort_modes ->> category_name, ''), 'name')
from public.category_order co
cross join lateral jsonb_array_elements_text(co.categories) with ordinality as category_ord(category_name, ordinality)
join public.categories c on c.name = case
  when lower(trim(category_name)) = 'kitchen' then 'Cooking'
  when category_name = 'Bag / Package' then 'Packs & Bags'
  else trim(category_name)
end
where coalesce(nullif(co.sort_modes ->> category_name, ''), 'name') in ('name', 'weight', 'price', 'year', 'rating')
on conflict (user_id, category_id) do update
set
  order_index = excluded.order_index,
  sort_mode = excluded.sort_mode,
  updated_at = now();

create or replace function public.sync_gear_item_category_id()
returns trigger
language plpgsql
as $$
declare
  normalized_category text;
begin
  if new.category_id is not null then
    select name into normalized_category
    from public.categories
    where id = new.category_id;

    new.category = normalized_category;
    return new;
  end if;

  normalized_category := case
    when trim(coalesce(new.category, '')) = '' then null
    when lower(trim(new.category)) = 'kitchen' then 'Cooking'
    when new.category = 'Bag / Package' then 'Packs & Bags'
    else trim(new.category)
  end;

  if normalized_category is null then
    new.category_id = null;
    new.category = null;
    return new;
  end if;

  select id into new.category_id
  from public.categories
  where name = normalized_category
    and is_active = true;

  new.category = normalized_category;
  return new;
end $$;

drop trigger if exists sync_gear_item_category_id_trigger on public.gear_items;
create trigger sync_gear_item_category_id_trigger
  before insert or update of category, category_id on public.gear_items
  for each row
  execute function public.sync_gear_item_category_id();

alter table public.categories enable row level security;
alter table public.user_category_preferences enable row level security;

drop policy if exists categories_select_all on public.categories;
create policy categories_select_all
  on public.categories for select to anon, authenticated
  using (is_active);

drop policy if exists user_category_preferences_select_owner on public.user_category_preferences;
create policy user_category_preferences_select_owner
  on public.user_category_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_category_preferences_insert_owner on public.user_category_preferences;
create policy user_category_preferences_insert_owner
  on public.user_category_preferences for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_category_preferences_update_owner on public.user_category_preferences;
create policy user_category_preferences_update_owner
  on public.user_category_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_category_preferences_delete_owner on public.user_category_preferences;
create policy user_category_preferences_delete_owner
  on public.user_category_preferences for delete to authenticated
  using (auth.uid() = user_id);
