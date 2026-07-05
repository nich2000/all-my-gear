-- Authoritative application schema for All My Gear.

create table if not exists public.storages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint storages_user_name_key unique (user_id, name)
);

comment on table public.storages is 'Storage locations for gear items (e.g., garage, closet, shed)';

create table if not exists public.gear_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  category text,
  name text not null,
  brand text,
  model text,
  weight integer not null default 0,
  price numeric not null default 0,
  year integer,
  rating integer not null default 0,
  image_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  order_index integer,
  comment text,
  storage_id uuid,
  constraint gear_items_storage_id_fkey
    foreign key (storage_id) references public.storages(id) on delete set null,
  constraint gear_items_weight_non_negative check (weight >= 0),
  constraint gear_items_price_non_negative check (price >= 0),
  constraint gear_items_rating_range check (rating between 0 and 5),
  constraint gear_items_year_reasonable check (year is null or (year between 1900 and 2100))
);

comment on column public.gear_items.storage_id is 'Reference to the storage location where this item is kept';

alter table if exists public.gear_items
  add column if not exists order_index integer;
alter table if exists public.gear_items
  add column if not exists comment text;
alter table if exists public.gear_items
  add column if not exists storage_id uuid;

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  description text,
  activities jsonb default '[]'::jsonb,
  items jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  start_date date,
  end_date date,
  constraint checklists_date_order check (start_date is null or end_date is null or start_date <= end_date)
);

comment on column public.checklists.start_date is 'Start date of the trip/checklist';
comment on column public.checklists.end_date is 'End date of the trip/checklist';

alter table if exists public.checklists
  add column if not exists start_date date;
alter table if exists public.checklists
  add column if not exists end_date date;

create table if not exists public.category_order (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  categories jsonb not null default '[]'::jsonb,
  sort_modes jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint category_order_user_id_key unique (user_id)
);

create table if not exists public.shared_items (
  id uuid primary key default gen_random_uuid(),
  share_code varchar not null unique,
  item_id uuid,
  checklist_id uuid,
  owner_id uuid not null references auth.users(id),
  item_data jsonb not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  constraint check_item_or_checklist check ((item_id is not null) <> (checklist_id is not null)),
  constraint shared_items_item_id_fkey
    foreign key (item_id) references public.gear_items(id) on delete cascade,
  constraint shared_items_checklist_id_fkey
    foreign key (checklist_id) references public.checklists(id) on delete cascade
);

comment on column public.shared_items.checklist_id is 'Reference to checklist being shared (mutually exclusive with item_id)';

alter table if exists public.shared_items
  add column if not exists item_id uuid;
alter table if exists public.shared_items
  add column if not exists checklist_id uuid;

create index if not exists idx_storages_user_id on public.storages(user_id);
create index if not exists idx_gear_items_user_id on public.gear_items(user_id);
create index if not exists idx_gear_items_storage_id on public.gear_items(storage_id);
create index if not exists idx_checklists_user_id on public.checklists(user_id);
create index if not exists idx_shared_items_owner_id on public.shared_items(owner_id);
create index if not exists idx_shared_items_expires_at on public.shared_items(expires_at);

alter table public.storages enable row level security;
alter table public.gear_items enable row level security;
alter table public.checklists enable row level security;
alter table public.category_order enable row level security;
alter table public.shared_items enable row level security;

drop policy if exists "Users can view their own storages" on public.storages;
drop policy if exists users_can_view_own_storages on public.storages;
create policy users_can_view_own_storages
  on public.storages for select
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own storages" on public.storages;
drop policy if exists users_can_insert_own_storages on public.storages;
create policy users_can_insert_own_storages
  on public.storages for insert
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own storages" on public.storages;
drop policy if exists users_can_update_own_storages on public.storages;
create policy users_can_update_own_storages
  on public.storages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own storages" on public.storages;
drop policy if exists users_can_delete_own_storages on public.storages;
create policy users_can_delete_own_storages
  on public.storages for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view their own gear items" on public.gear_items;
drop policy if exists users_can_view_own_gear_items on public.gear_items;
create policy users_can_view_own_gear_items
  on public.gear_items for select
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own gear items" on public.gear_items;
drop policy if exists users_can_insert_own_gear_items on public.gear_items;
create policy users_can_insert_own_gear_items
  on public.gear_items for insert
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own gear items" on public.gear_items;
drop policy if exists users_can_update_own_gear_items on public.gear_items;
create policy users_can_update_own_gear_items
  on public.gear_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own gear items" on public.gear_items;
drop policy if exists users_can_delete_own_gear_items on public.gear_items;
create policy users_can_delete_own_gear_items
  on public.gear_items for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view their own checklists" on public.checklists;
drop policy if exists users_can_view_own_checklists on public.checklists;
create policy users_can_view_own_checklists
  on public.checklists for select
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own checklists" on public.checklists;
drop policy if exists users_can_insert_own_checklists on public.checklists;
create policy users_can_insert_own_checklists
  on public.checklists for insert
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own checklists" on public.checklists;
drop policy if exists users_can_update_own_checklists on public.checklists;
create policy users_can_update_own_checklists
  on public.checklists for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own checklists" on public.checklists;
drop policy if exists users_can_delete_own_checklists on public.checklists;
create policy users_can_delete_own_checklists
  on public.checklists for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view their own category order" on public.category_order;
drop policy if exists users_can_view_own_category_order on public.category_order;
create policy users_can_view_own_category_order
  on public.category_order for select
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own category order" on public.category_order;
drop policy if exists users_can_insert_own_category_order on public.category_order;
create policy users_can_insert_own_category_order
  on public.category_order for insert
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own category order" on public.category_order;
drop policy if exists users_can_update_own_category_order on public.category_order;
create policy users_can_update_own_category_order
  on public.category_order for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own category order" on public.category_order;
drop policy if exists users_can_delete_own_category_order on public.category_order;
create policy users_can_delete_own_category_order
  on public.category_order for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view their own shared items" on public.shared_items;
drop policy if exists users_can_view_own_shared_items on public.shared_items;
create policy users_can_view_own_shared_items
  on public.shared_items for select to authenticated
  using (auth.uid() = owner_id);
drop policy if exists "Users can insert their own shared items" on public.shared_items;
drop policy if exists users_can_insert_own_shared_items on public.shared_items;
create policy users_can_insert_own_shared_items
  on public.shared_items for insert to authenticated
  with check (auth.uid() = owner_id);
drop policy if exists "Users can update their own shared items" on public.shared_items;
drop policy if exists users_can_update_own_shared_items on public.shared_items;
create policy users_can_update_own_shared_items
  on public.shared_items for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
drop policy if exists "Users can delete their own shared items" on public.shared_items;
drop policy if exists users_can_delete_own_shared_items on public.shared_items;
create policy users_can_delete_own_shared_items
  on public.shared_items for delete to authenticated
  using (auth.uid() = owner_id);
drop policy if exists "Anyone can read non-expired public shares" on public.shared_items;
drop policy if exists anyone_can_read_non_expired_public_shares on public.shared_items;
create policy anyone_can_read_non_expired_public_shares
  on public.shared_items for select to anon, authenticated
  using (expires_at > now());
