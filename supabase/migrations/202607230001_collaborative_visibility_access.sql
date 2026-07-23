-- Collaborative visibility for gear items and checklists.
-- Keeps temporary snapshot links separate from permanent per-user access grants.

alter table public.subscription_plans
  add column if not exists can_grant_edit boolean not null default false;
alter table public.subscription_plans
  add column if not exists max_shared_users integer not null default 0;
alter table public.subscription_plans
  add column if not exists max_editors integer not null default 0;
alter table public.subscription_plans
  add column if not exists max_active_share_links integer not null default 0;

update public.subscription_plans
set
  can_grant_edit = false,
  max_shared_users = 0,
  max_editors = 0,
  max_active_share_links = 3,
  updated_at = now()
where code = 'free';

update public.subscription_plans
set
  can_grant_edit = true,
  max_shared_users = 50,
  max_editors = 10,
  max_active_share_links = 50,
  updated_at = now()
where code = 'subscriber';

create or replace view public.user_entitlements
with (security_invoker = true)
as
select
  us.user_id,
  bool_or(sp.can_make_private) as can_make_private,
  bool_or(sp.can_share_with_users) as can_share_with_users,
  bool_or(sp.can_grant_edit) as can_grant_edit,
  max(sp.max_shared_users) as max_shared_users,
  max(sp.max_editors) as max_editors,
  max(sp.max_active_share_links) as max_active_share_links
from public.user_subscriptions us
join public.subscription_plans sp on sp.id = us.plan_id
where us.status in ('active', 'trialing')
  and (us.current_period_end is null or us.current_period_end > now())
group by us.user_id;

create or replace function public.can_use_edit_sharing(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ue.can_grant_edit
      from public.user_entitlements ue
      where ue.user_id = can_use_edit_sharing.user_id
    ),
    false
  );
$$;

-- Normalize old grants before adding stricter constraints.
update public.resource_access_grants
set grantee_email = lower(trim(grantee_email))
where grantee_email is not null;

update public.resource_access_grants
set grantee_email = null
where grantee_user_id is not null
  and grantee_email is not null;

delete from public.resource_access_grants rag
where rag.grantee_user_id = rag.owner_id;

delete from public.resource_access_grants duplicate
using public.resource_access_grants keep
where duplicate.id > keep.id
  and duplicate.resource_type = keep.resource_type
  and duplicate.resource_id = keep.resource_id
  and (
    (
      duplicate.grantee_user_id is not null
      and duplicate.grantee_user_id = keep.grantee_user_id
    )
    or (
      duplicate.grantee_email is not null
      and lower(duplicate.grantee_email) = lower(keep.grantee_email)
    )
  );

alter table public.resource_access_grants
  drop constraint if exists resource_access_grants_role_check;
alter table public.resource_access_grants
  drop constraint if exists resource_access_grants_grantee_check;
alter table public.resource_access_grants
  drop constraint if exists resource_access_grants_not_owner_check;

alter table public.resource_access_grants
  add constraint resource_access_grants_role_check
  check (role in ('viewer', 'editor'));
alter table public.resource_access_grants
  add constraint resource_access_grants_grantee_check
  check ((grantee_user_id is not null) <> (grantee_email is not null));
alter table public.resource_access_grants
  add constraint resource_access_grants_not_owner_check
  check (grantee_user_id is null or grantee_user_id <> owner_id);

create unique index if not exists uq_resource_access_grants_user
  on public.resource_access_grants(resource_type, resource_id, grantee_user_id)
  where grantee_user_id is not null;
create unique index if not exists uq_resource_access_grants_email
  on public.resource_access_grants(resource_type, resource_id, lower(grantee_email))
  where grantee_email is not null;

create or replace function public.resource_owner_id(
  target_resource_type text,
  target_resource_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result uuid;
begin
  case target_resource_type
    when 'gear_item' then
      select gi.user_id into result
      from public.gear_items gi
      where gi.id = target_resource_id;
    when 'checklist' then
      select c.user_id into result
      from public.checklists c
      where c.id = target_resource_id;
    when 'storage' then
      select s.user_id into result
      from public.storages s
      where s.id = target_resource_id;
    else
      return null;
  end case;
  return result;
end;
$$;

create or replace function public.validate_resource_access_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_owner uuid;
begin
  actual_owner := public.resource_owner_id(new.resource_type, new.resource_id);
  if actual_owner is null then
    raise exception 'Resource does not exist';
  end if;
  if new.owner_id <> actual_owner then
    raise exception 'Grant owner does not own the resource';
  end if;
  if new.grantee_user_id = actual_owner then
    raise exception 'Owner cannot be a grantee';
  end if;
  if not public.can_use_shared_visibility(actual_owner) then
    raise exception 'Shared visibility is not available for this owner';
  end if;
  if new.role = 'editor' and not public.can_use_edit_sharing(actual_owner) then
    raise exception 'Editable sharing is not available for this owner';
  end if;
  if new.grantee_email is not null then
    new.grantee_email := lower(trim(new.grantee_email));
  end if;
  return new;
end;
$$;

drop trigger if exists validate_resource_access_grant_trigger
  on public.resource_access_grants;
create trigger validate_resource_access_grant_trigger
before insert or update on public.resource_access_grants
for each row execute function public.validate_resource_access_grant();

create or replace function public.can_edit_gear_item(item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gear_items gi
    where gi.id = can_edit_gear_item.item_id
      and (
        gi.user_id = auth.uid()
        or (
          gi.visibility = 'shared'
          and exists (
            select 1
            from public.resource_access_grants rag
            where rag.resource_type = 'gear_item'
              and rag.resource_id = gi.id
              and rag.owner_id = gi.user_id
              and rag.role = 'editor'
              and (
                rag.grantee_user_id = auth.uid()
                or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
              )
          )
        )
      )
  );
$$;

create or replace function public.can_edit_checklist(checklist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.checklists c
    where c.id = can_edit_checklist.checklist_id
      and (
        c.user_id = auth.uid()
        or (
          c.visibility = 'shared'
          and exists (
            select 1
            from public.resource_access_grants rag
            where rag.resource_type = 'checklist'
              and rag.resource_id = c.id
              and rag.owner_id = c.user_id
              and rag.role = 'editor'
              and (
                rag.grantee_user_id = auth.uid()
                or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
              )
          )
        )
      )
  );
$$;

create or replace function public.protect_collaborative_resource_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_is_owner boolean;
  actor_can_edit boolean;
begin
  -- Administrative/service-role writes do not carry a user claim.
  if actor is null then
    return new;
  end if;

  actor_is_owner := old.user_id = actor;
  actor_can_edit := case tg_table_name
    when 'gear_items' then public.can_edit_gear_item(old.id)
    when 'checklists' then public.can_edit_checklist(old.id)
    else false
  end;

  if not actor_is_owner and not actor_can_edit then
    raise exception 'Resource is read-only for the current user';
  end if;

  if not actor_is_owner then
    if new.id is distinct from old.id
      or new.user_id is distinct from old.user_id
      or new.visibility is distinct from old.visibility
      or new.visibility_updated_at is distinct from old.visibility_updated_at
      or new.published_at is distinct from old.published_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Editors cannot change ownership or access settings';
    end if;
  elsif new.visibility is distinct from old.visibility then
    if not public.has_visibility_entitlement(actor, new.visibility) then
      raise exception 'Visibility is not available for the current subscription';
    end if;
    new.visibility_updated_at := now();
    if new.visibility = 'public' then
      new.published_at := now();
    else
      new.published_at := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_collaborative_gear_update on public.gear_items;
create trigger protect_collaborative_gear_update
before update on public.gear_items
for each row execute function public.protect_collaborative_resource_update();

drop trigger if exists protect_collaborative_checklist_update on public.checklists;
create trigger protect_collaborative_checklist_update
before update on public.checklists
for each row execute function public.protect_collaborative_resource_update();

drop policy if exists gear_items_update_owner_with_entitlement on public.gear_items;
drop policy if exists gear_items_update_owner_or_editor on public.gear_items;
create policy gear_items_update_owner_or_editor
  on public.gear_items for update to authenticated
  using (
    (select auth.uid()) = user_id
    or public.can_edit_gear_item(id)
  )
  with check (
    (select auth.uid()) = user_id
    or public.can_edit_gear_item(id)
  );

drop policy if exists checklists_update_owner_with_entitlement on public.checklists;
drop policy if exists checklists_update_owner_or_editor on public.checklists;
create policy checklists_update_owner_or_editor
  on public.checklists for update to authenticated
  using (
    (select auth.uid()) = user_id
    or public.can_edit_checklist(id)
  )
  with check (
    (select auth.uid()) = user_id
    or public.can_edit_checklist(id)
  );

create or replace function public.get_resource_access_settings(
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  owner uuid;
  resource_visibility text;
  recipients jsonb;
  links jsonb;
begin
  owner := public.resource_owner_id(p_resource_type, p_resource_id);
  if owner is null or owner <> auth.uid() then
    raise exception 'Only the owner can manage access';
  end if;

  if p_resource_type = 'gear_item' then
    select visibility into resource_visibility
    from public.gear_items where id = p_resource_id;
  elsif p_resource_type = 'checklist' then
    select visibility into resource_visibility
    from public.checklists where id = p_resource_id;
  else
    raise exception 'Unsupported resource type';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rag.id,
        'user_id', rag.grantee_user_id,
        'email', coalesce(u.email, rag.grantee_email),
        'role', rag.role
      )
      order by coalesce(u.email, rag.grantee_email), rag.created_at
    ),
    '[]'::jsonb
  )
  into recipients
  from public.resource_access_grants rag
  left join auth.users u on u.id = rag.grantee_user_id
  where rag.resource_type = p_resource_type
    and rag.resource_id = p_resource_id
    and rag.owner_id = owner;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', si.id,
        'share_code', si.share_code,
        'created_at', si.created_at,
        'expires_at', si.expires_at
      )
      order by si.created_at desc
    ),
    '[]'::jsonb
  )
  into links
  from public.shared_items si
  where si.owner_id = owner
    and si.expires_at > now()
    and (
      (p_resource_type = 'gear_item' and si.item_id = p_resource_id)
      or (p_resource_type = 'checklist' and si.checklist_id = p_resource_id)
    );

  return jsonb_build_object(
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'visibility', resource_visibility,
    'recipients', recipients,
    'temporary_links', links
  );
end;
$$;

create or replace function public.configure_resource_access(
  p_resource_type text,
  p_resource_id uuid,
  p_visibility text,
  p_recipients jsonb default '[]'::jsonb,
  p_revoke_temporary_links boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  owner uuid;
  recipient jsonb;
  recipient_user_id uuid;
  recipient_email text;
  recipient_role text;
  shared_limit integer;
  editor_limit integer;
  requested_count integer;
  requested_editor_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_resource_type not in ('gear_item', 'checklist') then
    raise exception 'Unsupported resource type';
  end if;
  if p_visibility not in ('public', 'private', 'shared') then
    raise exception 'Unsupported visibility';
  end if;

  owner := public.resource_owner_id(p_resource_type, p_resource_id);
  if owner is null or owner <> auth.uid() then
    raise exception 'Only the owner can manage access';
  end if;
  if not public.has_visibility_entitlement(owner, p_visibility) then
    raise exception 'Visibility is not available for the current subscription';
  end if;

  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then
    raise exception 'Recipients must be an array';
  end if;

  requested_count := jsonb_array_length(coalesce(p_recipients, '[]'::jsonb));
  select
    coalesce(ue.max_shared_users, 0),
    coalesce(ue.max_editors, 0)
  into shared_limit, editor_limit
  from public.user_entitlements ue
  where ue.user_id = owner;
  shared_limit := coalesce(shared_limit, 0);
  editor_limit := coalesce(editor_limit, 0);

  select count(*)
  into requested_editor_count
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) value
  where coalesce(value ->> 'role', 'viewer') = 'editor';

  if p_visibility = 'shared' and requested_count > shared_limit then
    raise exception 'Shared user limit exceeded';
  end if;
  if requested_editor_count > editor_limit then
    raise exception 'Editor limit exceeded';
  end if;
  if requested_editor_count > 0 and not public.can_use_edit_sharing(owner) then
    raise exception 'Editable sharing is not available for the current subscription';
  end if;

  delete from public.resource_access_grants rag
  where rag.resource_type = p_resource_type
    and rag.resource_id = p_resource_id
    and rag.owner_id = owner;

  if p_visibility = 'shared' then
    for recipient in
      select value from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
    loop
      recipient_role := coalesce(recipient ->> 'role', 'viewer');
      if recipient_role not in ('viewer', 'editor') then
        raise exception 'Unsupported recipient role';
      end if;

      recipient_user_id := null;
      recipient_email := nullif(lower(trim(recipient ->> 'email')), '');
      if nullif(recipient ->> 'user_id', '') is not null then
        begin
          recipient_user_id := (recipient ->> 'user_id')::uuid;
        exception when invalid_text_representation then
          raise exception 'Invalid recipient user id';
        end;
      end if;

      if recipient_user_id is null and recipient_email is not null then
        select u.id, lower(u.email)
        into recipient_user_id, recipient_email
        from auth.users u
        where lower(u.email) = recipient_email
        limit 1;
      elsif recipient_user_id is not null then
        select u.id, lower(u.email)
        into recipient_user_id, recipient_email
        from auth.users u
        where u.id = recipient_user_id;
      end if;

      if recipient_user_id is null then
        raise exception 'Recipient account was not found';
      end if;
      if recipient_user_id = owner then
        raise exception 'Owner cannot be a recipient';
      end if;

      insert into public.resource_access_grants (
        resource_type,
        resource_id,
        owner_id,
        grantee_user_id,
        role
      )
      values (
        p_resource_type,
        p_resource_id,
        owner,
        recipient_user_id,
        recipient_role
      );
    end loop;
  end if;

  if p_resource_type = 'gear_item' then
    update public.gear_items
    set visibility = p_visibility
    where id = p_resource_id and user_id = owner;
  else
    update public.checklists
    set visibility = p_visibility
    where id = p_resource_id and user_id = owner;
  end if;

  if p_revoke_temporary_links then
    delete from public.shared_items si
    where si.owner_id = owner
      and (
        (p_resource_type = 'gear_item' and si.item_id = p_resource_id)
        or (p_resource_type = 'checklist' and si.checklist_id = p_resource_id)
      );
  end if;

  return public.get_resource_access_settings(p_resource_type, p_resource_id);
end;
$$;

create or replace function public.revoke_temporary_share_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shared_items
  where id = p_link_id
    and owner_id = auth.uid();
  if not found then
    raise exception 'Temporary link was not found';
  end if;
end;
$$;

drop function if exists public.search_visible_gear(text, int, int);
drop function if exists public.search_visible_gear(text, int, int, text);

create function public.search_visible_gear(
  search_query text,
  result_limit int,
  result_offset int,
  access_scope text default 'all_visible'
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  category text,
  brand text,
  model text,
  weight integer,
  price numeric,
  year integer,
  rating integer,
  comment text,
  image_path text,
  storage_id uuid,
  visibility text,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  order_index integer,
  access_source text,
  share_direction text,
  access_role text,
  can_edit boolean,
  recipient_count integer,
  active_link_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    gi.id,
    gi.user_id,
    gi.name,
    gi.category,
    gi.brand,
    gi.model,
    gi.weight,
    gi.price,
    gi.year,
    gi.rating,
    gi.comment,
    gi.image_path,
    gi.storage_id,
    gi.visibility,
    gi.published_at,
    gi.created_at,
    gi.updated_at,
    gi.order_index,
    case
      when gi.user_id = auth.uid() then 'mine'
      when gi.visibility = 'public' then 'public'
      else 'shared_with_me'
    end,
    case
      when gi.user_id = auth.uid()
        and (
          exists (
            select 1 from public.resource_access_grants own_rag
            where own_rag.resource_type = 'gear_item'
              and own_rag.resource_id = gi.id
              and own_rag.owner_id = gi.user_id
          )
          or exists (
            select 1 from public.shared_items own_link
            where own_link.item_id = gi.id
              and own_link.owner_id = gi.user_id
              and own_link.expires_at > now()
          )
        ) then 'shared_by_me'
      when gi.user_id <> auth.uid() and gi.visibility = 'shared' then 'shared_with_me'
      else null
    end,
    (
      select rag.role
      from public.resource_access_grants rag
      where rag.resource_type = 'gear_item'
        and rag.resource_id = gi.id
        and rag.owner_id = gi.user_id
        and (
          rag.grantee_user_id = auth.uid()
          or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
        )
      limit 1
    ),
    public.can_edit_gear_item(gi.id),
    case when gi.user_id = auth.uid() then (
      select count(*)::integer
      from public.resource_access_grants rag
      where rag.resource_type = 'gear_item'
        and rag.resource_id = gi.id
        and rag.owner_id = gi.user_id
    ) else 0 end,
    case when gi.user_id = auth.uid() then (
      select count(*)::integer
      from public.shared_items si
      where si.item_id = gi.id
        and si.owner_id = gi.user_id
        and si.expires_at > now()
    ) else 0 end
  from public.gear_items gi
  where public.can_read_gear_item(gi.id)
    and (
      coalesce(search_query, '') = ''
      or gi.name ilike '%' || search_query || '%'
      or gi.category ilike '%' || search_query || '%'
      or gi.brand ilike '%' || search_query || '%'
      or gi.model ilike '%' || search_query || '%'
    )
    and (
      coalesce(access_scope, 'all_visible') in ('all', 'all_visible')
      or (access_scope = 'mine' and gi.user_id = auth.uid())
      or (
        access_scope = 'public'
        and gi.visibility = 'public'
        and gi.user_id <> auth.uid()
      )
      or (
        access_scope = 'shared_with_me'
        and gi.visibility = 'shared'
        and gi.user_id <> auth.uid()
      )
      or (
        access_scope = 'shared_by_me'
        and gi.user_id = auth.uid()
        and (
          exists (
            select 1 from public.resource_access_grants own_rag
            where own_rag.resource_type = 'gear_item'
              and own_rag.resource_id = gi.id
              and own_rag.owner_id = gi.user_id
          )
          or exists (
            select 1 from public.shared_items own_link
            where own_link.item_id = gi.id
              and own_link.owner_id = gi.user_id
              and own_link.expires_at > now()
          )
        )
      )
    )
  order by gi.updated_at desc nulls last, gi.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

drop function if exists public.search_visible_checklists(text, int, int);
drop function if exists public.search_visible_checklists(text, int, int, text);

create function public.search_visible_checklists(
  search_query text,
  result_limit int,
  result_offset int,
  access_scope text default 'all_visible'
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  description text,
  activities jsonb,
  items jsonb,
  start_date date,
  end_date date,
  visibility text,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  access_source text,
  share_direction text,
  access_role text,
  can_edit boolean,
  recipient_count integer,
  active_link_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.user_id,
    c.name,
    c.description,
    c.activities,
    c.items,
    c.start_date,
    c.end_date,
    c.visibility,
    c.published_at,
    c.created_at,
    c.updated_at,
    case
      when c.user_id = auth.uid() then 'mine'
      when c.visibility = 'public' then 'public'
      else 'shared_with_me'
    end,
    case
      when c.user_id = auth.uid()
        and (
          exists (
            select 1 from public.resource_access_grants own_rag
            where own_rag.resource_type = 'checklist'
              and own_rag.resource_id = c.id
              and own_rag.owner_id = c.user_id
          )
          or exists (
            select 1 from public.shared_items own_link
            where own_link.checklist_id = c.id
              and own_link.owner_id = c.user_id
              and own_link.expires_at > now()
          )
        ) then 'shared_by_me'
      when c.user_id <> auth.uid() and c.visibility = 'shared' then 'shared_with_me'
      else null
    end,
    (
      select rag.role
      from public.resource_access_grants rag
      where rag.resource_type = 'checklist'
        and rag.resource_id = c.id
        and rag.owner_id = c.user_id
        and (
          rag.grantee_user_id = auth.uid()
          or lower(rag.grantee_email) = lower(auth.jwt() ->> 'email')
        )
      limit 1
    ),
    public.can_edit_checklist(c.id),
    case when c.user_id = auth.uid() then (
      select count(*)::integer
      from public.resource_access_grants rag
      where rag.resource_type = 'checklist'
        and rag.resource_id = c.id
        and rag.owner_id = c.user_id
    ) else 0 end,
    case when c.user_id = auth.uid() then (
      select count(*)::integer
      from public.shared_items si
      where si.checklist_id = c.id
        and si.owner_id = c.user_id
        and si.expires_at > now()
    ) else 0 end
  from public.checklists c
  where public.can_read_checklist(c.id)
    and (
      coalesce(search_query, '') = ''
      or c.name ilike '%' || search_query || '%'
      or c.description ilike '%' || search_query || '%'
    )
    and (
      coalesce(access_scope, 'all_visible') in ('all', 'all_visible')
      or (access_scope = 'mine' and c.user_id = auth.uid())
      or (
        access_scope = 'public'
        and c.visibility = 'public'
        and c.user_id <> auth.uid()
      )
      or (
        access_scope = 'shared_with_me'
        and c.visibility = 'shared'
        and c.user_id <> auth.uid()
      )
      or (
        access_scope = 'shared_by_me'
        and c.user_id = auth.uid()
        and (
          exists (
            select 1 from public.resource_access_grants own_rag
            where own_rag.resource_type = 'checklist'
              and own_rag.resource_id = c.id
              and own_rag.owner_id = c.user_id
          )
          or exists (
            select 1 from public.shared_items own_link
            where own_link.checklist_id = c.id
              and own_link.owner_id = c.user_id
              and own_link.expires_at > now()
          )
        )
      )
    )
  order by c.updated_at desc nulls last, c.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;

drop policy if exists gear_photos_read_accessible_items on storage.objects;
create policy gear_photos_read_accessible_items
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'gear-photos'
    and public.can_read_gear_item((storage.foldername(name))[1]::uuid)
  );

revoke execute on function public.get_resource_access_settings(text, uuid) from public, anon;
revoke execute on function public.configure_resource_access(text, uuid, text, jsonb, boolean) from public, anon;
revoke execute on function public.revoke_temporary_share_link(uuid) from public, anon;
grant execute on function public.get_resource_access_settings(text, uuid) to authenticated;
grant execute on function public.configure_resource_access(text, uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.revoke_temporary_share_link(uuid) to authenticated;
