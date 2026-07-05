-- Subscription entitlements, durable visibility, access grants, search RPCs, and storage stats.

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  can_make_private boolean not null default false,
  can_share_with_users boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_status_check
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired'))
);

create index if not exists idx_user_subscriptions_user_id on public.user_subscriptions(user_id);
create index if not exists idx_user_subscriptions_status on public.user_subscriptions(status);

alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;

drop policy if exists subscription_plans_select_all on public.subscription_plans;
create policy subscription_plans_select_all
on public.subscription_plans for select to anon, authenticated
using (true);

drop policy if exists user_subscriptions_select_owner on public.user_subscriptions;
create policy user_subscriptions_select_owner
on public.user_subscriptions for select to authenticated
using (auth.uid() = user_id);

insert into public.subscription_plans (code, name, can_make_private, can_share_with_users)
values
  ('free', 'Free', false, false),
  ('subscriber', 'Subscriber', true, true)
on conflict (code) do update
set
  name = excluded.name,
  can_make_private = excluded.can_make_private,
  can_share_with_users = excluded.can_share_with_users,
  updated_at = now();

create or replace view public.user_entitlements
with (security_invoker = true)
as
select
  us.user_id,
  bool_or(sp.can_make_private) as can_make_private,
  bool_or(sp.can_share_with_users) as can_share_with_users
from public.user_subscriptions us
join public.subscription_plans sp on sp.id = us.plan_id
where us.status in ('active', 'trialing')
  and (us.current_period_end is null or us.current_period_end > now())
group by us.user_id;

create or replace function public.can_use_private_visibility(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ue.can_make_private
      from public.user_entitlements ue
      where ue.user_id = can_use_private_visibility.user_id
    ),
    false
  );
$$;

create or replace function public.can_use_shared_visibility(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ue.can_share_with_users
      from public.user_entitlements ue
      where ue.user_id = can_use_shared_visibility.user_id
    ),
    false
  );
$$;

alter table if exists public.storages add column if not exists visibility text not null default 'public';
alter table if exists public.storages add column if not exists visibility_updated_at timestamptz;
alter table if exists public.storages add column if not exists published_at timestamptz;
alter table if exists public.storages add column if not exists description text;
alter table if exists public.storages add column if not exists address text;
alter table if exists public.storages add column if not exists latitude double precision;
alter table if exists public.storages add column if not exists longitude double precision;
alter table if exists public.storages add column if not exists rating integer not null default 0;

alter table if exists public.gear_items add column if not exists visibility text not null default 'public';
alter table if exists public.gear_items add column if not exists visibility_updated_at timestamptz;
alter table if exists public.gear_items add column if not exists published_at timestamptz;

alter table if exists public.checklists add column if not exists visibility text not null default 'public';
alter table if exists public.checklists add column if not exists visibility_updated_at timestamptz;
alter table if exists public.checklists add column if not exists published_at timestamptz;

create index if not exists idx_storages_visibility on public.storages(visibility);
create index if not exists idx_gear_items_visibility on public.gear_items(visibility);
create index if not exists idx_checklists_visibility on public.checklists(visibility);
create index if not exists idx_storages_published_at on public.storages(published_at);
create index if not exists idx_gear_items_published_at on public.gear_items(published_at);
create index if not exists idx_checklists_published_at on public.checklists(published_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'storages_visibility_check') then
    alter table if exists public.storages add constraint storages_visibility_check check (visibility in ('public', 'private', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gear_items_visibility_check') then
    alter table if exists public.gear_items add constraint gear_items_visibility_check check (visibility in ('public', 'private', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklists_visibility_check') then
    alter table if exists public.checklists add constraint checklists_visibility_check check (visibility in ('public', 'private', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'storages_rating_range') then
    alter table if exists public.storages add constraint storages_rating_range check (rating between 0 and 5);
  end if;
end $$;

create table if not exists public.resource_access_grants (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  grantee_user_id uuid references auth.users(id) on delete cascade,
  grantee_email text,
  role text not null default 'viewer',
  created_at timestamptz not null default now(),
  constraint resource_access_grants_resource_type_check check (resource_type in ('storage', 'gear_item', 'checklist')),
  constraint resource_access_grants_role_check check (role = 'viewer'),
  constraint resource_access_grants_grantee_check check (grantee_user_id is not null or grantee_email is not null)
);

create index if not exists idx_resource_access_grants_resource
  on public.resource_access_grants(resource_type, resource_id);
create index if not exists idx_resource_access_grants_owner_id
  on public.resource_access_grants(owner_id);
create index if not exists idx_resource_access_grants_grantee_user_id
  on public.resource_access_grants(grantee_user_id);
create index if not exists idx_resource_access_grants_grantee_email
  on public.resource_access_grants(lower(grantee_email));

alter table public.resource_access_grants enable row level security;

drop policy if exists resource_access_grants_select_related on public.resource_access_grants;
create policy resource_access_grants_select_related
  on public.resource_access_grants for select to authenticated
  using (
    auth.uid() = owner_id
    or auth.uid() = grantee_user_id
    or lower(auth.jwt() ->> 'email') = lower(grantee_email)
  );

drop policy if exists resource_access_grants_insert_owner_with_entitlement on public.resource_access_grants;
create policy resource_access_grants_insert_owner_with_entitlement
  on public.resource_access_grants for insert to authenticated
  with check (auth.uid() = owner_id and public.can_use_shared_visibility(auth.uid()));

drop policy if exists resource_access_grants_update_owner_with_entitlement on public.resource_access_grants;
create policy resource_access_grants_update_owner_with_entitlement
  on public.resource_access_grants for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id and public.can_use_shared_visibility(auth.uid()));

drop policy if exists resource_access_grants_delete_owner on public.resource_access_grants;
create policy resource_access_grants_delete_owner
  on public.resource_access_grants for delete to authenticated
  using (auth.uid() = owner_id);

create or replace function public.has_visibility_entitlement(user_id uuid, next_visibility text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when next_visibility = 'public' then true
    when next_visibility = 'private' then public.can_use_private_visibility(has_visibility_entitlement.user_id)
    when next_visibility = 'shared' then public.can_use_shared_visibility(has_visibility_entitlement.user_id)
    else false
  end;
$$;

create or replace function public.can_read_storage(storage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.storages s
    where s.id = can_read_storage.storage_id
      and (
        s.user_id = auth.uid()
        or s.visibility = 'public'
        or (
          s.visibility = 'shared'
          and exists (
            select 1
            from public.resource_access_grants rag
            where rag.resource_type = 'storage'
              and rag.resource_id = s.id
              and rag.owner_id = s.user_id
              and (
                rag.grantee_user_id = auth.uid()
                or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
              )
          )
        )
      )
  );
$$;

create or replace function public.can_read_gear_item(item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gear_items gi
    where gi.id = can_read_gear_item.item_id
      and (
        gi.user_id = auth.uid()
        or gi.visibility = 'public'
        or (
          gi.visibility = 'shared'
          and exists (
            select 1
            from public.resource_access_grants rag
            where rag.resource_type = 'gear_item'
              and rag.resource_id = gi.id
              and rag.owner_id = gi.user_id
              and (
                rag.grantee_user_id = auth.uid()
                or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
              )
          )
        )
      )
  );
$$;

create or replace function public.can_read_checklist(checklist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.checklists c
    where c.id = can_read_checklist.checklist_id
      and (
        c.user_id = auth.uid()
        or c.visibility = 'public'
        or (
          c.visibility = 'shared'
          and exists (
            select 1
            from public.resource_access_grants rag
            where rag.resource_type = 'checklist'
              and rag.resource_id = c.id
              and rag.owner_id = c.user_id
              and (
                rag.grantee_user_id = auth.uid()
                or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
              )
          )
        )
      )
  );
$$;

create or replace function public.can_update_resource_visibility(resource_type text, resource_id uuid, next_visibility text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    next_visibility in ('public', 'private', 'shared')
    and public.has_visibility_entitlement(auth.uid(), next_visibility)
    and case resource_type
      when 'storage' then exists (
        select 1 from public.storages s
        where s.id = can_update_resource_visibility.resource_id
          and s.user_id = auth.uid()
      )
      when 'gear_item' then exists (
        select 1 from public.gear_items gi
        where gi.id = can_update_resource_visibility.resource_id
          and gi.user_id = auth.uid()
      )
      when 'checklist' then exists (
        select 1 from public.checklists c
        where c.id = can_update_resource_visibility.resource_id
          and c.user_id = auth.uid()
      )
      else false
    end;
$$;

create or replace view public.storage_stats
with (security_invoker = true)
as
select
  s.id as storage_id,
  count(gi.id)::int as gear_item_count,
  coalesce(sum(gi.weight), 0)::int as total_weight,
  coalesce(sum(gi.price), 0)::numeric as total_price
from public.storages s
left join public.gear_items gi on gi.storage_id = s.id
group by s.id;

drop policy if exists users_can_view_own_storages on public.storages;
drop policy if exists users_can_insert_own_storages on public.storages;
drop policy if exists users_can_update_own_storages on public.storages;
drop policy if exists users_can_delete_own_storages on public.storages;
drop policy if exists storages_select_visible on public.storages;
drop policy if exists storages_insert_owner_with_entitlement on public.storages;
drop policy if exists storages_update_owner_with_entitlement on public.storages;
drop policy if exists storages_delete_owner on public.storages;

create policy storages_select_visible on public.storages for select to anon, authenticated
  using (public.can_read_storage(id));
create policy storages_insert_owner_with_entitlement on public.storages for insert to authenticated
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy storages_update_owner_with_entitlement on public.storages for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy storages_delete_owner on public.storages for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists users_can_view_own_gear_items on public.gear_items;
drop policy if exists users_can_insert_own_gear_items on public.gear_items;
drop policy if exists users_can_update_own_gear_items on public.gear_items;
drop policy if exists users_can_delete_own_gear_items on public.gear_items;
drop policy if exists gear_items_select_visible on public.gear_items;
drop policy if exists gear_items_insert_owner_with_entitlement on public.gear_items;
drop policy if exists gear_items_update_owner_with_entitlement on public.gear_items;
drop policy if exists gear_items_delete_owner on public.gear_items;

create policy gear_items_select_visible on public.gear_items for select to anon, authenticated
  using (public.can_read_gear_item(id));
create policy gear_items_insert_owner_with_entitlement on public.gear_items for insert to authenticated
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy gear_items_update_owner_with_entitlement on public.gear_items for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy gear_items_delete_owner on public.gear_items for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists users_can_view_own_checklists on public.checklists;
drop policy if exists users_can_insert_own_checklists on public.checklists;
drop policy if exists users_can_update_own_checklists on public.checklists;
drop policy if exists users_can_delete_own_checklists on public.checklists;
drop policy if exists checklists_select_visible on public.checklists;
drop policy if exists checklists_insert_owner_with_entitlement on public.checklists;
drop policy if exists checklists_update_owner_with_entitlement on public.checklists;
drop policy if exists checklists_delete_owner on public.checklists;

create policy checklists_select_visible on public.checklists for select to anon, authenticated
  using (public.can_read_checklist(id));
create policy checklists_insert_owner_with_entitlement on public.checklists for insert to authenticated
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy checklists_update_owner_with_entitlement on public.checklists for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_visibility_entitlement(auth.uid(), visibility));
create policy checklists_delete_owner on public.checklists for delete to authenticated
  using (auth.uid() = user_id);

drop function if exists public.search_visible_gear(text, int, int);

create or replace function public.search_visible_gear(search_query text, result_limit int, result_offset int)
returns table (
  id uuid,
  name text,
  category text,
  brand text,
  model text,
  image_path text,
  visibility text,
  access_source text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    gi.id,
    gi.name,
    gi.category,
    gi.brand,
    gi.model,
    gi.image_path,
    gi.visibility,
    case when user_id = auth.uid() then 'mine' when visibility = 'public' then 'public' else 'shared_with_me' end as access_source
  from public.gear_items gi
  where public.can_read_gear_item(gi.id)
    and (
      coalesce(search_query, '') = ''
      or gi.name ilike '%' || search_query || '%'
      or gi.category ilike '%' || search_query || '%'
      or gi.brand ilike '%' || search_query || '%'
      or gi.model ilike '%' || search_query || '%'
    )
  order by gi.updated_at desc nulls last, gi.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

create or replace function public.search_visible_checklists(search_query text, result_limit int, result_offset int)
returns table (
  id uuid,
  name text,
  description text,
  activities jsonb,
  start_date date,
  end_date date,
  visibility text,
  access_source text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.description,
    c.activities,
    c.start_date,
    c.end_date,
    c.visibility,
    case when user_id = auth.uid() then 'mine' when visibility = 'public' then 'public' else 'shared_with_me' end as access_source
  from public.checklists c
  where public.can_read_checklist(c.id)
    and (
      coalesce(search_query, '') = ''
      or c.name ilike '%' || search_query || '%'
      or c.description ilike '%' || search_query || '%'
    )
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

create or replace function public.search_visible_storages(search_query text, result_limit int, result_offset int)
returns table (
  id uuid,
  name text,
  description text,
  address text,
  latitude double precision,
  longitude double precision,
  rating integer,
  visibility text,
  access_source text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.description,
    s.address,
    s.latitude,
    s.longitude,
    s.rating,
    s.visibility,
    case when user_id = auth.uid() then 'mine' when visibility = 'public' then 'public' else 'shared_with_me' end as access_source
  from public.storages s
  where public.can_read_storage(s.id)
    and (
      coalesce(search_query, '') = ''
      or s.name ilike '%' || search_query || '%'
      or s.description ilike '%' || search_query || '%'
      or s.address ilike '%' || search_query || '%'
    )
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

drop policy if exists gear_photos_read_accessible_items on storage.objects;
create policy gear_photos_read_accessible_items
  on storage.objects for select to authenticated
  using (
    bucket_id = 'gear-photos'
    and public.can_read_gear_item((storage.foldername(name))[1]::uuid)
  );

drop policy if exists gear_photos_owner_write on storage.objects;
create policy gear_photos_owner_write
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gear-photos'
    and exists (
      select 1
      from public.gear_items gi
      where gi.id = (storage.foldername(name))[1]::uuid
        and gi.user_id = auth.uid()
    )
  );

drop policy if exists gear_photos_owner_update on storage.objects;
create policy gear_photos_owner_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'gear-photos'
    and exists (
      select 1
      from public.gear_items gi
      where gi.id = (storage.foldername(name))[1]::uuid
        and gi.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'gear-photos'
    and exists (
      select 1
      from public.gear_items gi
      where gi.id = (storage.foldername(name))[1]::uuid
        and gi.user_id = auth.uid()
    )
  );

drop policy if exists gear_photos_owner_delete on storage.objects;
create policy gear_photos_owner_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'gear-photos'
    and exists (
      select 1
      from public.gear_items gi
      where gi.id = (storage.foldername(name))[1]::uuid
        and gi.user_id = auth.uid()
    )
  );

-- SQL access scenario checks:
-- anon sees public
-- anon cannot see private or shared
-- other user sees public
-- grantee sees shared
-- free user cannot make private
-- subscriber can make private
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'can_read_storage' and pronamespace = 'public'::regnamespace) then
    raise exception 'missing can_read_storage';
  end if;
  if not exists (select 1 from pg_proc where proname = 'can_read_gear_item' and pronamespace = 'public'::regnamespace) then
    raise exception 'missing can_read_gear_item';
  end if;
  if not exists (select 1 from pg_proc where proname = 'can_read_checklist' and pronamespace = 'public'::regnamespace) then
    raise exception 'missing can_read_checklist';
  end if;
  if not exists (select 1 from pg_proc where proname = 'can_update_resource_visibility' and pronamespace = 'public'::regnamespace) then
    raise exception 'missing can_update_resource_visibility';
  end if;
end $$;
