-- Ensure the Supabase Storage API role can access its metadata schema.

grant usage on schema storage to supabase_storage_admin;
grant all privileges on all tables in schema storage to supabase_storage_admin;
grant all privileges on all sequences in schema storage to supabase_storage_admin;

alter role service_role set search_path = storage, public, extensions;
grant usage on schema storage to service_role;
grant all privileges on all tables in schema storage to service_role;
grant all privileges on all sequences in schema storage to service_role;

drop policy if exists storage_migrations_admin_all on storage.migrations;
create policy storage_migrations_admin_all
  on storage.migrations for all to supabase_storage_admin
  using (true)
  with check (true);
