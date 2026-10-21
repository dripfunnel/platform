-- A Reports tab exported as CSV (ui/platform/FIRST-RELEASE.md §10; #200), the same job as the
-- activity export (0021).
alter table export_job drop constraint export_job_kind_check;
alter table export_job add constraint export_job_kind_check check (kind in ('activity', 'report'));
