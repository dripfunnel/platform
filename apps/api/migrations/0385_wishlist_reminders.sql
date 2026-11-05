-- Wishlist reminders (#1215; FIRST-RELEASE §9, DATA-MODEL §7.6): the carts' reminders for what a signed-in shopper saved. A store
-- sets up to three emails (delay, subject, message) that go to a shopper whose wishlist has sat untouched; the engine queues
-- and decides them in system scope; the merchant side reads them and writes the settings. Email only, no code (decided here).

alter table customer
  add column wishlist_reminders_stopped_at timestamptz(3),
  add column wishlist_reminders_stopped_by_user_id uuid references "user" (id) on delete set null,
  add column wishlist_reminders_stopped_note text check (char_length(wishlist_reminders_stopped_note) <= 200);
grant select (wishlist_reminders_stopped_at, wishlist_reminders_stopped_by_user_id, wishlist_reminders_stopped_note) on customer to app_request;

create table wishlist_reminder_flow (
  store_id uuid primary key references store (id),
  enabled boolean not null default false,
  skip_out_of_stock boolean not null default true,
  quiet_hours boolean not null default true,
  weekly_cap boolean not null default true,
  updated_at timestamptz(3) not null default now(),
  revision integer not null default 1
);

create table wishlist_reminder_step (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references wishlist_reminder_flow (store_id),
  position integer not null check (position between 1 and 3),
  enabled boolean not null,
  delay_minutes integer not null check (delay_minutes between 30 and 10080),
  subject text not null check (char_length(subject) <= 120),
  body text not null check (char_length(body) <= 500),
  unique (store_id, position)
);
create unique index wishlist_reminder_step_id_store_key on wishlist_reminder_step (id, store_id);

create table wishlist_reminder (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  customer_id uuid not null,
  -- Null for one sent by hand (sent_by_user_id).
  step_id uuid,
  sent_by_user_id uuid references "user" (id) on delete set null,
  state text not null default 'queued' check (state in ('queued', 'sent', 'skipped')),
  skip_reason text check (skip_reason in ('stopped', 'paused', 'no_contact', 'opted_out', 'undeliverable', 'out_of_stock', 'weekly_cap', 'empty', 'no_shop_host')),
  -- The wishlist's last change when this was queued: a step goes once for each state of the list.
  saved_at timestamptz(3) not null,
  -- The unsubscribe link's token, hashed, set as it is sent (ACCESS §6.1); never selected by a request role.
  link_token_hash text unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  queued_at timestamptz(3) not null default now(),
  sent_at timestamptz(3),
  check ((state = 'skipped') = (skip_reason is not null)),
  foreign key (customer_id, store_id) references customer (id, store_id) on delete cascade,
  foreign key (step_id, store_id) references wishlist_reminder_step (id, store_id)
);
create unique index wishlist_reminder_step_once on wishlist_reminder (customer_id, step_id, saved_at) where step_id is not null;
create index wishlist_reminder_customer_idx on wishlist_reminder (customer_id, queued_at desc);
create index wishlist_reminder_sent_idx on wishlist_reminder (store_id, sent_at desc) where sent_at is not null;

grant select, insert, update, delete on wishlist_reminder_flow, wishlist_reminder_step, wishlist_reminder to app_system;
grant select on wishlist_reminder_flow, wishlist_reminder_step to app_request;
grant insert (store_id, enabled, skip_out_of_stock, quiet_hours, weekly_cap) on wishlist_reminder_flow to app_request;
grant update (enabled, skip_out_of_stock, quiet_hours, weekly_cap, updated_at, revision) on wishlist_reminder_flow to app_request;
grant insert (store_id, position, enabled, delay_minutes, subject, body) on wishlist_reminder_step to app_request;
grant update (enabled, delay_minutes, subject, body) on wishlist_reminder_step to app_request;
grant select (id, store_id, customer_id, step_id, sent_by_user_id, state, skip_reason, saved_at, queued_at, sent_at) on wishlist_reminder to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['wishlist_reminder_flow', 'wishlist_reminder_step', 'wishlist_reminder'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
  -- The settings are the merchant side's to write, never a supplier's or a read-only support session's.
  foreach t in array array['wishlist_reminder_flow', 'wishlist_reminder_step'] loop
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = ''''
        and app_setting_text(''app.support'') <> ''read'')', t || '_merchant', t);
  end loop;
end
$$;
-- The sent reminders are the engine's: the merchant side reads them only.
create policy wishlist_reminder_merchant on wishlist_reminder for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
