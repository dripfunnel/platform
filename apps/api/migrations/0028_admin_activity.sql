-- The admin console's Activity log (ui/admin/FIRST-RELEASE.md §9; #38): an index for every
-- filter §9 names and the person timeline reads, and the staff export as a job like the
-- partner's (0021), with its own kind, no partner and a too-large outcome.

-- Declared on the parent, so every partition has them (0006).
create index activity_log_api_idx on activity_log (api, occurred_at desc, id desc);
create index activity_log_category_idx on activity_log (category, occurred_at desc, id desc);
create index activity_log_ip_idx on activity_log (ip, occurred_at desc, id desc) where ip is not null;
create index activity_log_access_idx on activity_log (access_ref, occurred_at desc, id desc) where access_ref is not null;
create index activity_log_on_behalf_idx on activity_log (on_behalf_of_kind, on_behalf_of_id, occurred_at desc, id desc) where on_behalf_of_id is not null;

-- A staff export belongs to no partner; LOGGING §6 caps it at 100,000 entries, and past that
-- the job ends as too large rather than as a partial file.
alter table export_job alter column partner_id drop not null;
alter table export_job drop constraint export_job_kind_check;
-- Every kind so far, `stores` (0026, #221) included, so this holds whichever lands first.
alter table export_job add constraint export_job_kind_check check (kind in ('activity', 'report', 'stores', 'staff_activity'));
alter table export_job add constraint export_job_partner_kind check ((partner_id is null) = (kind = 'staff_activity'));
-- A staff export can be large, so it is built a chunk per delivery: the log's cursor and the
-- file so far wait on the row between chunks (the relay gives each delivery seconds, not minutes).
alter table export_job add column cursor text;
-- The partner reads its own jobs whole (0021's column grant), so the new column too.
grant select (cursor) on export_job to app_partner;
alter table export_job drop constraint export_job_state_check;
alter table export_job add constraint export_job_state_check check (state in ('queued', 'done', 'failed', 'too_large'));
