-- Constraint hardening for databases that were created from the old snapshot.

alter table if exists public.gear_items
  drop constraint if exists gear_items_storage_id_fkey;

alter table if exists public.gear_items
  add constraint gear_items_storage_id_fkey
  foreign key (storage_id) references public.storages(id) on delete set null;

alter table if exists public.shared_items
  drop constraint if exists check_item_or_checklist;

alter table if exists public.shared_items
  add constraint check_item_or_checklist
  check ((item_id is not null) <> (checklist_id is not null))
  not valid;

alter table if exists public.shared_items
  drop constraint if exists shared_items_item_id_fkey;

alter table if exists public.shared_items
  add constraint shared_items_item_id_fkey
  foreign key (item_id) references public.gear_items(id) on delete cascade
  not valid;

alter table if exists public.shared_items
  drop constraint if exists shared_items_checklist_id_fkey;

alter table if exists public.shared_items
  add constraint shared_items_checklist_id_fkey
  foreign key (checklist_id) references public.checklists(id) on delete cascade
  not valid;
