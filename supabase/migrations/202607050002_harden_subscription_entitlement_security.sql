-- Resolve Supabase public schema security lint for subscription entitlement objects.

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
