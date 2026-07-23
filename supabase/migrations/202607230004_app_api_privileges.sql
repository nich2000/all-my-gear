-- Complete the object privileges required by the browser -> PostgREST runtime.
-- Existing RLS policies continue to restrict rows for owner-scoped tables.

grant select on table public.categories to anon, authenticated;
grant select on table public.outdoor_brands to anon, authenticated;
grant select on table public.outdoor_activities to anon, authenticated;
grant select on table public.checklist_activities to anon, authenticated;
grant insert, delete on table public.checklist_activities to authenticated;

grant select on table public.storages to anon, authenticated;
grant insert, update, delete on table public.storages to authenticated;
grant select on table public.storage_stats to authenticated;

grant select, insert, update, delete
  on table public.category_order
  to authenticated;
grant select, insert, update, delete
  on table public.user_category_preferences
  to authenticated;
