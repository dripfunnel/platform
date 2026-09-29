create table schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
