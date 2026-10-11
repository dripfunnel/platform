-- SAPI 17 (#318), part 1: the template gallery the Store API reads and the studio's chat (DATA-MODEL §7.8).

-- The gallery is ST 0's (#486, migration 0300); this makes the same table and rows where 0300 hasn't run yet, so the
-- gallery exists whichever card merges first, and does nothing where it has.
do $$
begin
  if to_regclass('public.storefront_template') is not null then
    return;
  end if;
  create table storefront_template (
    key text primary key check (key ~ '^[a-z0-9-]{1,40}$'),
    name text not null check (length(name) between 1 and 40),
    tag text not null check (length(tag) between 1 and 40),
    description text not null check (length(description) between 1 and 200),
    demo_store_id uuid references store (id),
    core_min_version text not null check (core_min_version ~ '^\d+\.\d+\.\d+$'),
    state text not null default 'offered' check (state in ('offered', 'retired'))
  );
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
end
$$;

-- The studio's chat (PortalStorefront): the merchant's requests, the AI's replies and the notes between them. A note's
-- and an error's text is a code the portal words (FIRST-RELEASE §14), never stored words.
create table design_message (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  role text not null check (role in ('user', 'ai', 'note', 'error')),
  text text not null check (char_length(text) <= 4000),
  changed text[] not null default '{}' check (cardinality(changed) <= 5),
  image_asset_id uuid references asset (id),
  sample_url text check (char_length(sample_url) <= 2048),
  page text check (char_length(page) <= 200),
  commit text check (commit ~ '^[0-9a-f]{40}$'),
  before_commit text check (before_commit ~ '^[0-9a-f]{40}$'),
  undone boolean not null default false,
  ai_run_id uuid references ai_run (id),
  created_by uuid references "user" (id),
  created_at timestamptz not null default now()
);
create index design_message_store_idx on design_message (store_id, created_at desc, id desc);

-- The studio writes it in system scope; the merchant side reads its own store's (the Owner and the Manager).
grant select on design_message to app_request;
grant select, insert, update, delete on design_message to app_system;
alter table design_message enable row level security;
alter table design_message force row level security;
create policy design_message_system on design_message for all to app_system using (true) with check (true);
create policy design_message_merchant on design_message for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on design_message as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on design_message as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on design_message as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on design_message as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
