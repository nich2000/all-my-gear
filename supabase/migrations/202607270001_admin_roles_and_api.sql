begin;

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_permissions (
  code text primary key,
  name text not null,
  description text not null default ''
);

create table if not exists public.app_role_permissions (
  role_id uuid not null references public.app_roles(id) on delete cascade,
  permission_code text not null references public.app_permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.app_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.app_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists idx_app_user_roles_role_id
  on public.app_user_roles(role_id);

alter table public.app_roles enable row level security;
alter table public.app_permissions enable row level security;
alter table public.app_role_permissions enable row level security;
alter table public.app_user_roles enable row level security;

revoke all on table public.app_roles from anon, authenticated;
revoke all on table public.app_permissions from anon, authenticated;
revoke all on table public.app_role_permissions from anon, authenticated;
revoke all on table public.app_user_roles from anon, authenticated;

insert into public.app_roles (code, name, description, is_system)
values
  ('user', 'User', 'Standard application user', true),
  ('admin', 'Admin', 'Manages users, catalogs and subscriptions', true),
  ('superadmin', 'Superadmin', 'Manages the complete administration and role matrix', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  updated_at = now();

insert into public.app_permissions (code, name, description)
values
  ('admin.access', 'Access admin panel', 'Open and use /admin'),
  ('users.read', 'View users', 'View registered users'),
  ('users.update', 'Edit users', 'Edit safe user profile fields'),
  ('users.roles.update', 'Assign roles', 'Assign application roles to users'),
  ('catalogs.read', 'View catalogs', 'View reference catalogs'),
  ('catalogs.update', 'Edit catalogs', 'Create and edit reference catalog entries'),
  ('roles.read', 'View roles', 'View roles and their permissions'),
  ('roles.update', 'Edit roles', 'Edit the role permission matrix'),
  ('subscriptions.read', 'View subscriptions', 'View subscription records'),
  ('subscriptions.update', 'Edit subscriptions', 'Create and edit subscription records')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description;

insert into public.app_role_permissions (role_id, permission_code)
select r.id, permission_code
from public.app_roles r
cross join lateral (
  values
    ('admin.access'),
    ('users.read'),
    ('users.update'),
    ('catalogs.read'),
    ('catalogs.update'),
    ('roles.read'),
    ('subscriptions.read'),
    ('subscriptions.update')
) as permissions(permission_code)
where r.code = 'admin'
on conflict do nothing;

insert into public.app_role_permissions (role_id, permission_code)
select r.id, p.code
from public.app_roles r
cross join public.app_permissions p
where r.code = 'superadmin'
on conflict do nothing;

insert into public.app_user_roles (user_id, role_id)
select u.id, r.id
from auth.users u
cross join public.app_roles r
where r.code = 'user'
on conflict do nothing;

insert into public.app_user_roles (user_id, role_id)
select u.id, r.id
from auth.users u
cross join public.app_roles r
where r.code = 'superadmin'
  and lower(u.email) in (
    'nich2000@mail.ru',
    'ili.gurevich@gmail.com',
    'nikolai.svistoun@gmail.com'
  )
on conflict do nothing;

create or replace function public.assign_default_app_roles()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.app_user_roles (user_id, role_id)
  select new.id, r.id
  from public.app_roles r
  where r.code = 'user'
  on conflict do nothing;

  if lower(new.email) in (
    'nich2000@mail.ru',
    'ili.gurevich@gmail.com',
    'nikolai.svistoun@gmail.com'
  ) then
    insert into public.app_user_roles (user_id, role_id)
    select new.id, r.id
    from public.app_roles r
    where r.code = 'superadmin'
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_default_app_roles_trigger on auth.users;
create trigger assign_default_app_roles_trigger
  after insert or update of email on auth.users
  for each row
  execute function public.assign_default_app_roles();

create or replace function public.current_user_has_app_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.app_user_roles ur
    join public.app_role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid()
      and rp.permission_code = requested_permission
  );
$$;

create or replace function public.require_app_permission(requested_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.current_user_has_app_permission(requested_permission) then
    raise exception 'Insufficient application permission: %', requested_permission
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assign_default_app_roles() from public, anon, authenticated;
revoke all on function public.current_user_has_app_permission(text) from public, anon;
revoke all on function public.require_app_permission(text) from public, anon, authenticated;
grant execute on function public.current_user_has_app_permission(text) to authenticated;

create or replace function public.get_my_admin_context()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'is_admin', public.current_user_has_app_permission('admin.access'),
    'roles', coalesce((
      select jsonb_agg(r.code order by r.code)
      from public.app_user_roles ur
      join public.app_roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(permission_code order by permission_code)
      from (
        select distinct rp.permission_code
        from public.app_user_roles ur
        join public.app_role_permissions rp on rp.role_id = ur.role_id
        where ur.user_id = auth.uid()
      ) permissions
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_my_admin_context() from public, anon;
grant execute on function public.get_my_admin_context() to authenticated;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  nickname text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  role_codes text[]
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('users.read');

  return query
  select
    u.id,
    u.email::text,
    coalesce(u.raw_user_meta_data ->> 'nickname', '')::text,
    u.created_at,
    u.last_sign_in_at,
    coalesce(array_agg(r.code order by r.code) filter (where r.code is not null), array[]::text[])
  from auth.users u
  left join public.app_user_roles ur on ur.user_id = u.id
  left join public.app_roles r on r.id = ur.role_id
  group by u.id, u.email, u.raw_user_meta_data, u.created_at, u.last_sign_in_at
  order by lower(u.email);
end;
$$;

create or replace function public.admin_update_user(
  target_user_id uuid,
  new_nickname text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('users.update');

  update auth.users
  set
    raw_user_meta_data = jsonb_set(
      coalesce(raw_user_meta_data, '{}'::jsonb),
      '{nickname}',
      to_jsonb(trim(coalesce(new_nickname, ''))),
      true
    ),
    updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_update_user_roles(
  target_user_id uuid,
  new_role_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_role_codes text[];
begin
  perform public.require_app_permission('users.roles.update');

  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select array_agg(distinct role_code order by role_code)
  into normalized_role_codes
  from unnest(array_append(coalesce(new_role_codes, array[]::text[]), 'user')) role_code;

  if exists (
    select 1
    from unnest(normalized_role_codes) role_code
    where not exists (select 1 from public.app_roles r where r.code = role_code)
  ) then
    raise exception 'Unknown role code' using errcode = '22023';
  end if;

  if target_user_id = auth.uid()
     and not ('superadmin' = any(normalized_role_codes)) then
    raise exception 'A superadmin cannot remove their own superadmin role'
      using errcode = '42501';
  end if;

  delete from public.app_user_roles where user_id = target_user_id;

  insert into public.app_user_roles (user_id, role_id)
  select target_user_id, r.id
  from public.app_roles r
  where r.code = any(normalized_role_codes);
end;
$$;

create or replace function public.admin_list_roles()
returns table (
  id uuid,
  code text,
  name text,
  description text,
  is_system boolean,
  permission_codes text[]
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('roles.read');

  return query
  select
    r.id,
    r.code,
    r.name,
    r.description,
    r.is_system,
    coalesce(
      array_agg(rp.permission_code order by rp.permission_code)
        filter (where rp.permission_code is not null),
      array[]::text[]
    )
  from public.app_roles r
  left join public.app_role_permissions rp on rp.role_id = r.id
  group by r.id
  order by case r.code when 'user' then 1 when 'admin' then 2 when 'superadmin' then 3 else 4 end, r.code;
end;
$$;

create or replace function public.admin_list_permissions()
returns table (code text, name text, description text)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('roles.read');
  return query
  select p.code, p.name, p.description
  from public.app_permissions p
  order by p.code;
end;
$$;

create or replace function public.admin_update_role(
  target_role_id uuid,
  new_name text,
  new_description text,
  new_permission_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_role_code text;
  normalized_permissions text[];
begin
  perform public.require_app_permission('roles.update');

  select r.code into target_role_code
  from public.app_roles r
  where r.id = target_role_id;

  if target_role_code is null then
    raise exception 'Role not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct permission_code order by permission_code), array[]::text[])
  into normalized_permissions
  from unnest(coalesce(new_permission_codes, array[]::text[])) permission_code;

  if exists (
    select 1
    from unnest(normalized_permissions) permission_code
    where not exists (select 1 from public.app_permissions p where p.code = permission_code)
  ) then
    raise exception 'Unknown permission code' using errcode = '22023';
  end if;

  if target_role_code in ('admin', 'superadmin')
     and not ('admin.access' = any(normalized_permissions)) then
    raise exception 'Administrative roles must retain admin.access'
      using errcode = '22023';
  end if;

  if target_role_code = 'superadmin'
     and (
       not ('roles.update' = any(normalized_permissions))
       or not ('users.roles.update' = any(normalized_permissions))
     ) then
    raise exception 'The superadmin role must retain role-management permissions'
      using errcode = '22023';
  end if;

  update public.app_roles
  set
    name = trim(new_name),
    description = trim(coalesce(new_description, '')),
    updated_at = now()
  where id = target_role_id;

  if trim(coalesce(new_name, '')) = '' then
    raise exception 'Role name is required' using errcode = '22023';
  end if;

  delete from public.app_role_permissions where role_id = target_role_id;

  insert into public.app_role_permissions (role_id, permission_code)
  select target_role_id, permission_code
  from unnest(normalized_permissions) permission_code;
end;
$$;

create or replace function public.admin_list_subscriptions()
returns table (
  id uuid,
  user_id uuid,
  email text,
  plan_code text,
  plan_name text,
  status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('subscriptions.read');

  return query
  select
    us.id,
    us.user_id,
    u.email::text,
    sp.code,
    sp.name,
    us.status,
    us.current_period_start,
    us.current_period_end,
    us.created_at
  from public.user_subscriptions us
  join auth.users u on u.id = us.user_id
  join public.subscription_plans sp on sp.id = us.plan_id
  order by lower(u.email), us.created_at desc;
end;
$$;

create or replace function public.admin_list_subscription_plans()
returns table (code text, name text)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('subscriptions.read');
  return query
  select sp.code, sp.name
  from public.subscription_plans sp
  order by sp.name;
end;
$$;

create or replace function public.admin_save_subscription(
  subscription_id uuid,
  target_user_id uuid,
  target_plan_code text,
  target_status text,
  period_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  selected_plan_id uuid;
  saved_id uuid;
begin
  perform public.require_app_permission('subscriptions.update');

  if target_status not in ('active', 'trialing', 'past_due', 'canceled', 'expired') then
    raise exception 'Unknown subscription status' using errcode = '22023';
  end if;

  select sp.id into selected_plan_id
  from public.subscription_plans sp
  where sp.code = target_plan_code;

  if selected_plan_id is null then
    raise exception 'Subscription plan not found' using errcode = 'P0002';
  end if;

  if subscription_id is null then
    insert into public.user_subscriptions (
      user_id,
      plan_id,
      status,
      current_period_start,
      current_period_end
    )
    values (
      target_user_id,
      selected_plan_id,
      target_status,
      now(),
      period_end
    )
    returning id into saved_id;
  else
    update public.user_subscriptions
    set
      user_id = target_user_id,
      plan_id = selected_plan_id,
      status = target_status,
      current_period_end = period_end,
      updated_at = now()
    where id = subscription_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Subscription not found' using errcode = 'P0002';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.admin_list_catalog(catalog_code text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.require_app_permission('catalogs.read');

  case catalog_code
    when 'categories' then
      return query
      select to_jsonb(c)
      from public.categories c
      order by c.display_order, c.name;
    when 'outdoor_brands' then
      return query
      select to_jsonb(b)
      from public.outdoor_brands b
      order by b.display_order, b.display_name;
    when 'outdoor_activities' then
      return query
      select to_jsonb(a)
      from public.outdoor_activities a
      order by a.display_order, a.display_name;
    else
      raise exception 'Unknown catalog' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.admin_save_catalog_item(
  catalog_code text,
  item_id uuid,
  item_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  saved_id uuid;
  item_name text := trim(coalesce(item_data ->> 'name', ''));
  item_display_name text := trim(coalesce(item_data ->> 'display_name', item_data ->> 'name', ''));
  item_normalized_name text;
  item_display_order integer;
  item_is_active boolean;
begin
  perform public.require_app_permission('catalogs.update');

  if item_name = '' then
    raise exception 'Catalog item name is required' using errcode = '22023';
  end if;

  item_normalized_name := lower(trim(coalesce(item_data ->> 'normalized_name', item_display_name)));
  item_display_order := coalesce((item_data ->> 'display_order')::integer, 0);
  item_is_active := coalesce((item_data ->> 'is_active')::boolean, true);

  case catalog_code
    when 'categories' then
      if item_id is null then
        insert into public.categories (name, slug, display_order, is_active)
        values (
          item_name,
          trim(coalesce(nullif(item_data ->> 'slug', ''), lower(regexp_replace(item_name, '[^a-zA-Z0-9]+', '-', 'g')))),
          item_display_order,
          item_is_active
        )
        returning id into saved_id;
      else
        update public.categories
        set
          name = item_name,
          slug = trim(coalesce(nullif(item_data ->> 'slug', ''), slug)),
          display_order = item_display_order,
          is_active = item_is_active,
          updated_at = now()
        where id = item_id
        returning id into saved_id;
      end if;
    when 'outdoor_brands' then
      if item_id is null then
        insert into public.outdoor_brands (
          name, display_name, normalized_name, display_order, is_active
        )
        values (
          item_name, item_display_name, item_normalized_name, item_display_order, item_is_active
        )
        returning id into saved_id;
      else
        update public.outdoor_brands
        set
          name = item_name,
          display_name = item_display_name,
          normalized_name = item_normalized_name,
          display_order = item_display_order,
          is_active = item_is_active,
          updated_at = now()
        where id = item_id
        returning id into saved_id;
      end if;
    when 'outdoor_activities' then
      if item_id is null then
        insert into public.outdoor_activities (
          name, display_name, normalized_name, display_order, is_active
        )
        values (
          item_name, item_display_name, item_normalized_name, item_display_order, item_is_active
        )
        returning id into saved_id;
      else
        update public.outdoor_activities
        set
          name = item_name,
          display_name = item_display_name,
          normalized_name = item_normalized_name,
          display_order = item_display_order,
          is_active = item_is_active,
          updated_at = now()
        where id = item_id
        returning id into saved_id;
      end if;
    else
      raise exception 'Unknown catalog' using errcode = '22023';
  end case;

  if saved_id is null then
    raise exception 'Catalog item not found' using errcode = 'P0002';
  end if;

  return saved_id;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_update_user(uuid, text) from public, anon;
revoke all on function public.admin_update_user_roles(uuid, text[]) from public, anon;
revoke all on function public.admin_list_roles() from public, anon;
revoke all on function public.admin_list_permissions() from public, anon;
revoke all on function public.admin_update_role(uuid, text, text, text[]) from public, anon;
revoke all on function public.admin_list_subscriptions() from public, anon;
revoke all on function public.admin_list_subscription_plans() from public, anon;
revoke all on function public.admin_save_subscription(uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.admin_list_catalog(text) from public, anon;
revoke all on function public.admin_save_catalog_item(text, uuid, jsonb) from public, anon;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_update_user(uuid, text) to authenticated;
grant execute on function public.admin_update_user_roles(uuid, text[]) to authenticated;
grant execute on function public.admin_list_roles() to authenticated;
grant execute on function public.admin_list_permissions() to authenticated;
grant execute on function public.admin_update_role(uuid, text, text, text[]) to authenticated;
grant execute on function public.admin_list_subscriptions() to authenticated;
grant execute on function public.admin_list_subscription_plans() to authenticated;
grant execute on function public.admin_save_subscription(uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_list_catalog(text) to authenticated;
grant execute on function public.admin_save_catalog_item(text, uuid, jsonb) to authenticated;

commit;
