-- A partner's exports as jobs (ui/platform/FIRST-RELEASE.md §13, LOGGING §6; #198): asked for,
-- built after commit through the outbox, read back by id, so leaving the page loses nothing.
-- The CSV is kept on the row until it expires: no R2 bucket is bound yet (api/README.md §5).

create table export_job (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  kind text not null check (kind in ('activity')),
  filter jsonb not null,
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  rows integer check (rows >= 0),
  truncated boolean not null default false,
  csv text,
  requested_by_id uuid not null,
  requested_by_label text not null,
  created_at timestamptz(3) not null default now(),
  finished_at timestamptz(3),
  expires_at timestamptz(3),
  constraint export_job_done check ((state = 'done') = (csv is not null and rows is not null and finished_at is not null and expires_at is not null))
);

create index export_job_partner_idx on export_job (partner_id, created_at desc);

-- The partner asks and reads its own; the job (run in the partner's own scope, so the log's
-- policy decides what it may read) writes the result. Staff and jobs reach every row.
grant select (id, partner_id, kind, filter, state, rows, truncated, csv, requested_by_id, requested_by_label, created_at, finished_at, expires_at),
  insert (id, partner_id, kind, filter, requested_by_id, requested_by_label) on export_job to app_partner;
grant update (state, rows, truncated, csv, finished_at, expires_at) on export_job to app_partner;
grant select, insert, update on export_job to app_platform, app_system;
-- The hour is kept to: the cron deletes an expired export (LOGGING §6).
grant delete on export_job to app_system;

alter table export_job enable row level security;
alter table export_job force row level security;
create policy request_scope on export_job as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on export_job as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on export_job as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on export_job as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy export_job_partner on export_job for all to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy export_job_staff on export_job for all to app_platform, app_system using (true) with check (true);
