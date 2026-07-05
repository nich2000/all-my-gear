-- Resolve Supabase auth_rls_initplan lint for active RLS policies.

drop policy if exists users_can_view_own_category_order on public.category_order;
create policy users_can_view_own_category_order
  on public.category_order for select
  using ((select auth.uid()) = user_id);

drop policy if exists users_can_insert_own_category_order on public.category_order;
create policy users_can_insert_own_category_order
  on public.category_order for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists users_can_update_own_category_order on public.category_order;
create policy users_can_update_own_category_order
  on public.category_order for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists users_can_delete_own_category_order on public.category_order;
create policy users_can_delete_own_category_order
  on public.category_order for delete
  using ((select auth.uid()) = user_id);

drop policy if exists users_can_view_own_shared_items on public.shared_items;
create policy users_can_view_own_shared_items
  on public.shared_items for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or expires_at > now()
  );

drop policy if exists anyone_can_read_non_expired_public_shares on public.shared_items;
create policy anyone_can_read_non_expired_public_shares
  on public.shared_items for select to anon
  using (expires_at > now());

drop policy if exists users_can_insert_own_shared_items on public.shared_items;
create policy users_can_insert_own_shared_items
  on public.shared_items for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists users_can_update_own_shared_items on public.shared_items;
create policy users_can_update_own_shared_items
  on public.shared_items for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists users_can_delete_own_shared_items on public.shared_items;
create policy users_can_delete_own_shared_items
  on public.shared_items for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists resource_access_grants_select_related on public.resource_access_grants;
create policy resource_access_grants_select_related
  on public.resource_access_grants for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or (select auth.uid()) = grantee_user_id
    or lower((select auth.jwt()) ->> 'email') = lower(grantee_email)
  );

drop policy if exists resource_access_grants_insert_owner_with_entitlement on public.resource_access_grants;
create policy resource_access_grants_insert_owner_with_entitlement
  on public.resource_access_grants for insert to authenticated
  with check ((select auth.uid()) = owner_id and public.can_use_shared_visibility((select auth.uid())));

drop policy if exists resource_access_grants_update_owner_with_entitlement on public.resource_access_grants;
create policy resource_access_grants_update_owner_with_entitlement
  on public.resource_access_grants for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and public.can_use_shared_visibility((select auth.uid())));

drop policy if exists resource_access_grants_delete_owner on public.resource_access_grants;
create policy resource_access_grants_delete_owner
  on public.resource_access_grants for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists storages_insert_owner_with_entitlement on public.storages;
create policy storages_insert_owner_with_entitlement
  on public.storages for insert to authenticated
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists storages_update_owner_with_entitlement on public.storages;
create policy storages_update_owner_with_entitlement
  on public.storages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists storages_delete_owner on public.storages;
create policy storages_delete_owner
  on public.storages for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists gear_items_insert_owner_with_entitlement on public.gear_items;
create policy gear_items_insert_owner_with_entitlement
  on public.gear_items for insert to authenticated
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists gear_items_update_owner_with_entitlement on public.gear_items;
create policy gear_items_update_owner_with_entitlement
  on public.gear_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists gear_items_delete_owner on public.gear_items;
create policy gear_items_delete_owner
  on public.gear_items for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists checklists_insert_owner_with_entitlement on public.checklists;
create policy checklists_insert_owner_with_entitlement
  on public.checklists for insert to authenticated
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists checklists_update_owner_with_entitlement on public.checklists;
create policy checklists_update_owner_with_entitlement
  on public.checklists for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.has_visibility_entitlement((select auth.uid()), visibility));

drop policy if exists checklists_delete_owner on public.checklists;
create policy checklists_delete_owner
  on public.checklists for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_category_preferences_select_owner on public.user_category_preferences;
create policy user_category_preferences_select_owner
  on public.user_category_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_category_preferences_insert_owner on public.user_category_preferences;
create policy user_category_preferences_insert_owner
  on public.user_category_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_category_preferences_update_owner on public.user_category_preferences;
create policy user_category_preferences_update_owner
  on public.user_category_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_category_preferences_delete_owner on public.user_category_preferences;
create policy user_category_preferences_delete_owner
  on public.user_category_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists checklist_activities_insert_owner on public.checklist_activities;
create policy checklist_activities_insert_owner
  on public.checklist_activities for insert to authenticated
  with check (
    exists (
      select 1
      from public.checklists c
      where c.id = checklist_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists checklist_activities_delete_owner on public.checklist_activities;
create policy checklist_activities_delete_owner
  on public.checklist_activities for delete to authenticated
  using (
    exists (
      select 1
      from public.checklists c
      where c.id = checklist_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists user_subscriptions_select_owner on public.user_subscriptions;
create policy user_subscriptions_select_owner
  on public.user_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
