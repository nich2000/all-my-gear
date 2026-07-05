-- Runnable access checks for subscription visibility and permanent grants.
-- Execute after applying supabase/migrations/*.sql. The transaction rolls back all fixture data.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'grantee@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'subscriber@example.test')
on conflict (id) do nothing;

insert into public.user_subscriptions (user_id, plan_id, status)
select '00000000-0000-0000-0000-000000000004', id, 'active'
from public.subscription_plans
where code = 'subscriber'
on conflict do nothing;

insert into public.storages (id, user_id, name, visibility)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Public storage', 'public'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Private storage', 'private'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Shared storage', 'shared'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'Subscriber storage', 'public');

insert into public.resource_access_grants (
  resource_type,
  resource_id,
  owner_id,
  grantee_user_id,
  role
)
values (
  'storage',
  '10000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'viewer'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$
begin
  if not public.can_read_storage('10000000-0000-0000-0000-000000000001') then
    raise exception 'anon sees public failed';
  end if;
  if public.can_read_storage('10000000-0000-0000-0000-000000000002')
    or public.can_read_storage('10000000-0000-0000-0000-000000000003') then
    raise exception 'anon cannot see private or shared failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"email":"other@example.test"}', true);
do $$
begin
  if not public.can_read_storage('10000000-0000-0000-0000-000000000001') then
    raise exception 'other user sees public failed';
  end if;
  if public.can_read_storage('10000000-0000-0000-0000-000000000003') then
    raise exception 'other user must not see ungranted shared storage';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"email":"grantee@example.test"}', true);
do $$
begin
  if not public.can_read_storage('10000000-0000-0000-0000-000000000003') then
    raise exception 'grantee sees shared failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"email":"owner@example.test"}', true);
do $$
begin
  if public.can_update_resource_visibility('storage', '10000000-0000-0000-0000-000000000001', 'private') then
    raise exception 'free user cannot make private failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims', '{"email":"subscriber@example.test"}', true);
do $$
begin
  if not public.can_update_resource_visibility('storage', '10000000-0000-0000-0000-000000000004', 'private') then
    raise exception 'subscriber can make private failed';
  end if;
end $$;

rollback;
