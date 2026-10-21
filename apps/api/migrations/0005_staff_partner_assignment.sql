-- The partners a Partner manager acts on (ACCESS.md §5.4, DATA-MODEL.md §3.1, decided on #14).
-- Rows are written by the staff screens of a later card; nothing here creates one.

create table staff_partner_assignment (
  staff_user_id uuid not null references staff_user (id),
  partner_id uuid not null references partner (id),
  created_at timestamptz not null default now(),
  primary key (staff_user_id, partner_id)
);

create index staff_partner_assignment_partner_id_idx on staff_partner_assignment (partner_id);

grant select on staff_partner_assignment to app_request, app_system;

alter table staff_partner_assignment enable row level security;
alter table staff_partner_assignment force row level security;

create policy staff_partner_assignment_read on staff_partner_assignment for select
using (app_setting_text('app.scope') in ('platform', 'system'));
