-- INF 2b (#517): a store repo's build proves itself by GitHub OIDC, reports its checks and uploads (storefront LIVE-SHOP.md §4
-- steps 5–9, §9). Nothing here is destructive: new nullable columns only.

-- The repo's numeric id, which GitHub's OIDC token names as `repository_id` and which never changes with the repo's name.
alter table storefront add column repo_id bigint unique check (repo_id > 0);

alter table publish_run
  -- The Actions run the build id was bound to on its first use; any other run is refused (LIVE-SHOP §9).
  add column github_run_id bigint check (github_run_id > 0),
  -- The check step's report and the digest of the files it checked (LIVE-SHOP §4 step 7), never code.
  add column gate jsonb check (gate is null or jsonb_typeof(gate) = 'object'),
  add column gate_digest text check (gate_digest ~ '^[0-9a-f]{64}$'),
  -- "Uploaded": from here on no credential is issued and the staging folder is read once, then ignored (§4 step 9).
  add column uploaded_at timestamptz,
  -- The manifest as read once at "uploaded", its digest the report's; null with uploaded_at when it was refused.
  add column upload_manifest jsonb check (upload_manifest is null or jsonb_typeof(upload_manifest) = 'object'),
  -- Every staged object hashed to its manifest entry and was copied into the build's folders.
  add column verified_at timestamptz,
  add constraint publish_run_gate_whole check ((gate is null) = (gate_digest is null)),
  add constraint publish_run_uploaded_after_gate check (uploaded_at is null or gate is not null),
  add constraint publish_run_manifest_at_upload check (upload_manifest is null or uploaded_at is not null),
  add constraint publish_run_verified_after_upload check (verified_at is null or upload_manifest is not null);
