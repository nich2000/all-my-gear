-- Allow PostgREST roles to evaluate auth helper functions used by RLS and triggers.
-- This grants no access to auth tables.

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
