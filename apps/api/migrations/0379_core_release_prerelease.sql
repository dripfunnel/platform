-- Dev's releases are recorded and rolled out too (#1164): a dev build `<version>-dev.<run>` gets a core_release row.
alter table core_release drop constraint core_release_version_check,
  add constraint core_release_version_check check (version ~ '^\d+\.\d+\.\d+(-dev\.\d+)?$');
