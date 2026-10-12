-- SAPI 17 (#318), part 1: the studio's chat (DATA-MODEL §7.8). The template gallery is #486's storefront_template (0331).

-- The studio's chat (PortalStorefront). Part 1 writes only its notes, whose text is a code the portal words
-- (FIRST-RELEASE §14), never stored words; part 2 adds the requests, replies and errors.
create table design_message (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  role text not null constraint design_message_role_check check (role in ('note')),
  text text not null check (char_length(text) <= 4000),
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
