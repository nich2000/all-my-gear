-- Explicit PostgREST privileges for visibility-managed resources.
-- RLS remains the authorization boundary after these object-level grants.

grant usage on schema public to anon, authenticated;

grant select on table public.gear_items to anon, authenticated;
grant select on table public.checklists to anon, authenticated;
grant insert, update, delete on table public.gear_items to authenticated;
grant insert, update, delete on table public.checklists to authenticated;

grant select, insert, update, delete
  on table public.resource_access_grants
  to authenticated;

grant select on table public.shared_items to anon, authenticated;
grant insert, update, delete on table public.shared_items to authenticated;

grant select on table public.subscription_plans to anon, authenticated;
grant select on table public.user_subscriptions to authenticated;
grant select on table public.user_entitlements to authenticated;

grant execute on function public.can_read_gear_item(uuid) to anon, authenticated;
grant execute on function public.can_read_checklist(uuid) to anon, authenticated;
grant execute on function public.can_edit_gear_item(uuid) to authenticated;
grant execute on function public.can_edit_checklist(uuid) to authenticated;
grant execute on function public.search_visible_gear(text, integer, integer, text) to anon, authenticated;
grant execute on function public.search_visible_checklists(text, integer, integer, text) to anon, authenticated;
