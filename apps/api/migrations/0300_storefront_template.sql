-- ST 0 (#486): the template gallery (DATA-MODEL §7.8; storefront ARCHITECTURE §2.3). Each row is a starting theme in
-- templates/storefront/themes/{key} and mirrors its template.json; tests/storefront-templates.test.ts holds them equal.
create table storefront_template (
  key text primary key check (key ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (length(name) between 1 and 40),
  tag text not null check (length(tag) between 1 and 40),
  description text not null check (length(description) between 1 and 200),
  demo_store_id uuid references store (id),
  core_min_version text not null check (core_min_version ~ '^\d+\.\d+\.\d+$'),
  state text not null default 'offered' check (state in ('offered', 'retired'))
);

-- Staff read the gallery (SAAS §10); only the platform's own jobs change it, as for core_release (0250).
grant select on storefront_template to app_platform;
grant select, insert, update on storefront_template to app_system;
alter table storefront_template enable row level security;
alter table storefront_template force row level security;
create policy storefront_template_platform on storefront_template for select to app_platform using (app_setting_text('app.scope') = 'platform');
create policy storefront_template_system on storefront_template for all to app_system using (true) with check (true);
create policy request_scope on storefront_template as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on storefront_template as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront_template as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on storefront_template as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

insert into storefront_template (key, name, tag, description, core_min_version) values
  ('baseline', 'Start from scratch', 'Blank', 'A plain header, banner, story and footer. Describe your shop and the AI styles it.', '0.0.0'),
  ('linen', 'Linen', 'Minimal fashion', 'Light, roomy and quiet. Big photos, small type, nothing in the way.', '0.0.0'),
  ('concrete', 'Concrete', 'Bold streetwear', 'Loud type, hard edges and a bright accent. Built around drops.', '0.0.0'),
  ('bloom', 'Bloom', 'Beauty & wellness', 'Soft colour, rounded shapes and calm serif headings.', '0.0.0'),
  ('circuit', 'Circuit', 'Electronics & tech', 'Dark, sharp and spec-led. Clear details and help up front.', '0.0.0'),
  ('market', 'Market', 'Food & grocery', 'Warm, friendly and easy to browse. Fresh food first.', '0.0.0'),
  ('atelier', 'Atelier', 'Luxury editorial', 'Magazine-like pacing. Large serif type, muted tones, lots of space.', '0.0.0');
