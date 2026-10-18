-- Dev publishes storefront-core as `<version>-dev.<run>` (release.yml), so the version a store is on, a draft's and a
-- publish run's, may carry a prerelease suffix. Widens three checks; core_release stays plain (only main releases reach it).
alter table design_draft drop constraint design_draft_core_version_check,
  add constraint design_draft_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table publish_run drop constraint publish_run_core_version_check,
  add constraint publish_run_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table design_version drop constraint design_version_core_version_check,
  add constraint design_version_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
