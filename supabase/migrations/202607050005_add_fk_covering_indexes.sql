-- Cover foreign keys flagged by Supabase unindexed_foreign_keys lint.

create index if not exists idx_shared_items_item_id
  on public.shared_items(item_id);

create index if not exists idx_shared_items_checklist_id
  on public.shared_items(checklist_id);

create index if not exists idx_user_subscriptions_plan_id
  on public.user_subscriptions(plan_id);
