-- Resolve Supabase security lint for catalog trigger functions and pg_trgm.

alter function public.sync_gear_item_category_id() set search_path = public;
alter function public.sync_gear_item_brand_id() set search_path = public;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
alter extension pg_trgm set schema extensions;
