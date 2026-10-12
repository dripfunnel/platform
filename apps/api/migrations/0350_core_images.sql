-- INF 6 (#485), part 5: the retirement of old core versions' studio images (storefront AI-STUDIO §9, DATA-MODEL §7.8).
-- Nothing here is destructive: two new nullable columns.

-- retired_at: no store's live code or draft is on the version any more, so its image may go; image_deleted_at: the
-- scheduled workflow deleted it from Cloudflare's registry (the ghcr.io copy, which store repos' builds pull, stays).
alter table core_release
  add column retired_at timestamptz,
  add column image_deleted_at timestamptz,
  add constraint core_release_image_deleted_after_retired check (image_deleted_at is null or retired_at is not null);
