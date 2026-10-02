-- Who assigned a Partner manager, and an unassignment as removed_at rather than a delete
-- (ACCESS.md §5.4, decided on #60).

alter table staff_partner_assignment drop constraint staff_partner_assignment_pkey;

alter table staff_partner_assignment
  add column id uuid not null default gen_random_uuid(),
  add column assigned_by_staff_id uuid references staff_user (id),
  add column removed_at timestamptz,
  add column removed_by_staff_id uuid references staff_user (id);

alter table staff_partner_assignment add primary key (id);

-- One live assignment per pair; a pair may be assigned again after being removed. The unique
-- index serves every lookup by staff member; the partner side gets its own live index.
create unique index staff_partner_assignment_live_key on staff_partner_assignment (staff_user_id, partner_id) where removed_at is null;
create index staff_partner_assignment_partner_live_idx on staff_partner_assignment (partner_id) where removed_at is null;

-- Super admins write it from the Admin API; nothing else does (0005 gave requests select only).
grant insert, update on staff_partner_assignment to app_request;

create policy staff_partner_assignment_write on staff_partner_assignment for insert
with check (app_setting_text('app.scope') = 'platform');

create policy staff_partner_assignment_update on staff_partner_assignment for update
using (app_setting_text('app.scope') = 'platform')
with check (app_setting_text('app.scope') = 'platform');
