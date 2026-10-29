-- DL 15 (#852): a store's delivery app APK, uploaded by DripFunnel staff and kept in R2 (mobile-app/README.md §2; api/DELIVERY.md §5).
-- Versioned, append-only like store_app_assets: an upload, or a change to the minimum build, adds a version; none is changed or deleted.
-- The file is an R2 object key, never a URL. Only staff write (platform scope); the download link and the Delivery API read it in system scope.

create table store_delivery_app (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  version integer not null check (version >= 1),
  apk_key text not null,
  version_name text not null check (char_length(version_name) between 1 and 40),
  build_number integer not null check (build_number >= 1),
  size_bytes bigint not null check (size_bytes > 0),
  -- Builds below this number are told to update; null is no minimum.
  minimum_build integer check (minimum_build >= 1 and minimum_build <= build_number),
  created_by_staff_id uuid not null references staff_user (id),
  created_at timestamptz not null default now(),
  unique (store_id, version)
);

grant select, insert (store_id, version, apk_key, version_name, build_number, size_bytes, minimum_build, created_by_staff_id) on store_delivery_app to app_platform;
grant select on store_delivery_app to app_system;

alter table store_delivery_app enable row level security;
alter table store_delivery_app force row level security;
create policy store_delivery_app_platform_select on store_delivery_app for select to app_platform using (true);
create policy store_delivery_app_platform_insert on store_delivery_app for insert to app_platform with check (true);
create policy store_delivery_app_system on store_delivery_app for select to app_system using (true);
-- Every role is pinned to its scope (tests/isolation.test.ts); no store, partner, supplier, shopper or rider role has a grant at all.
create policy request_scope on store_delivery_app as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on store_delivery_app as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on store_delivery_app as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on store_delivery_app as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
