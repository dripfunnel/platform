-- INF 3 (#482), part 1: every published storefront-core version and its sandbox image (DATA-MODEL §7.8 "Platform scope"),
-- recorded by the release workflow once the image is on ghcr.io and in Cloudflare's registry (storefront AI-STUDIO §1).
-- sandbox_image is the Cloudflare reference, pinned by digest, that the studio's Durable Object starts.
create table core_release (
  version text primary key check (version ~ '^\d+\.\d+\.\d+$'),
  released_at timestamptz not null default now(),
  kind text not null check (kind in ('major', 'minor', 'patch')),
  security boolean not null default false,
  sandbox_image text not null check (sandbox_image ~ '^registry\.cloudflare\.com/[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$'),
  shop_api_versions text[] not null default '{}',
  notes_url text check (notes_url ~ '^https://')
);

-- Staff read the fleet's versions (SAAS §10); only the platform's own jobs and the release record one.
grant select on core_release to app_platform;
grant select, insert, update on core_release to app_system;
alter table core_release enable row level security;
alter table core_release force row level security;
create policy core_release_platform on core_release for select to app_platform using (app_setting_text('app.scope') = 'platform');
create policy core_release_system on core_release for all to app_system using (true) with check (true);
create policy request_scope on core_release as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on core_release as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on core_release as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on core_release as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
