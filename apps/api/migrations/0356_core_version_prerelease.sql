-- Dev publishes storefront-core as `<version>-dev.<run>` (release.yml), so the version a store is on, a draft's and a
-- publish run's, may carry a prerelease suffix. Widens three checks; core_release stays plain (only main releases reach it).
alter table design_draft drop constraint design_draft_core_version_check,
  add constraint design_draft_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table publish_run drop constraint publish_run_core_version_check,
  add constraint publish_run_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table design_version drop constraint design_version_core_version_check,
  add constraint design_version_core_version_check check (core_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table core_rollout_store drop constraint core_rollout_store_from_version_check,
  add constraint core_rollout_store_from_version_check check (from_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
alter table storefront drop constraint storefront_core_upgrade_version_check,
  add constraint storefront_core_upgrade_version_check check (core_upgrade_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
-- Sort key of a core version, the order of compareVersions: a release is newer than its dev builds, which go by run number.
create function core_version_key(v text) returns int[] language sql immutable strict as
  $$ select string_to_array(split_part(v, '-', 1), '.')::int[] || coalesce(nullif(split_part(v, '-dev.', 2), '')::int, 2147483647) $$;
