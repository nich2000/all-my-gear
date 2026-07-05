create table if not exists public.schema_migrations (
  filename text primary key,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now(),
  source text not null default 'apply-migrations.sh'
);

comment on table public.schema_migrations is 'Tracks application SQL migrations applied to this database.';
comment on column public.schema_migrations.filename is 'Migration SQL filename from supabase/migrations.';
comment on column public.schema_migrations.checksum_sha256 is 'SHA-256 checksum of the migration file at apply time.';
comment on column public.schema_migrations.applied_at is 'Database timestamp when the migration was recorded as applied.';
comment on column public.schema_migrations.source is 'Tool or migration that recorded this migration row.';

alter table public.schema_migrations enable row level security;

revoke all on public.schema_migrations from anon, authenticated;
