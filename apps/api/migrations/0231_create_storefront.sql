-- INF 1 (#316), part 2: the create-storefront Workflow (SAAS §5 steps 4–8) and the draft it leaves (DATA-MODEL §7.8).

-- The template the store's repo started from, recorded once the repo is ready (step 8).
alter table storefront add column template text check (template ~ '^[a-z0-9-]{1,40}$');

-- Steps 4–8 run as their own job when the merchant first picks a template, after the signup's steps 1–3.
alter table job drop constraint job_kind_check, add constraint job_kind_check check (kind in ('provision-store', 'create-storefront'));

-- The one unpublished design per store (storefront AI-STUDIO.md §4): its head commit and its preview's folder in R2.
-- base_version_id comes with design_version (INF 3).
create table design_draft (
  store_id uuid primary key references store (id),
  head_commit text not null check (head_commit ~ '^[0-9a-f]{40}$'),
  template text not null check (template ~ '^[a-z0-9-]{1,40}$'),
  core_version text not null check (core_version ~ '^\d+\.\d+\.\d+$'),
  changed_at timestamptz not null default now(),
  changed_by uuid references "user" (id),
  preview_deploy_ref text check (preview_deploy_ref ~ '^[A-Za-z0-9-]{1,64}$')
);

-- Jobs and the studio write it; the merchant side reads its own store's.
grant select on design_draft to app_request;
grant select, insert, update, delete on design_draft to app_system;
alter table design_draft enable row level security;
alter table design_draft force row level security;
create policy design_draft_system on design_draft for all to app_system using (true) with check (true);
create policy design_draft_merchant on design_draft for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on design_draft as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on design_draft as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on design_draft as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on design_draft as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
