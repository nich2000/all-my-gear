-- Allow INSERT ... RETURNING for an owner before helper functions can look the
-- newly inserted row up through a separate query.

drop policy if exists gear_items_select_visible on public.gear_items;
create policy gear_items_select_visible
on public.gear_items
for select
using (
  user_id = (select auth.uid())
  or visibility = 'public'
  or public.can_read_gear_item(id)
);

drop policy if exists checklists_select_visible on public.checklists;
create policy checklists_select_visible
on public.checklists
for select
using (
  user_id = (select auth.uid())
  or visibility = 'public'
  or public.can_read_checklist(id)
);

notify pgrst, 'reload schema';
