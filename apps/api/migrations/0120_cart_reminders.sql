-- SAPI 15 (#321), part 1: abandoned carts and their reminders (DATA-MODEL §7.2, §7.6, §7.7; FIRST-RELEASE §9). The engine
-- marks a cart abandoned and sends its reminders in system scope; the merchant side reads them and writes the settings.

alter table "order"
  -- The cart's own last change, to the microsecond, so a change since is always later (selectIdleCarts).
  add column abandoned_at timestamptz,
  -- What the cart came to when it was left, in its own currency: the list's value and the minimum's test (Carts).
  add column abandoned_amount bigint check (abandoned_amount >= 0),
  add column reminders_stopped_at timestamptz(3),
  add column reminders_stopped_by_user_id uuid references "user" (id) on delete set null,
  add column reminders_stopped_note text check (char_length(reminders_stopped_note) <= 200),
  add column recovered_by_order_id uuid,
  add column recovered_by_reminder_id uuid,
  add constraint order_recovered_by_fkey foreign key (recovered_by_order_id, store_id) references "order" (id, store_id);
create index order_abandoned_idx on "order" (store_id, abandoned_at desc) where abandoned_at is not null;
create index order_cart_idle_idx on "order" (updated_at) where state = 'cart';
grant select (abandoned_at, abandoned_amount, reminders_stopped_at, reminders_stopped_by_user_id, reminders_stopped_note, recovered_by_order_id,
  recovered_by_reminder_id) on "order" to app_request;

create table cart_reminder_flow (
  store_id uuid primary key references store (id),
  enabled boolean not null default false,
  min_amount bigint check (min_amount >= 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  skip_out_of_stock boolean not null default true,
  quiet_hours boolean not null default true,
  weekly_cap boolean not null default true,
  updated_at timestamptz(3) not null default now(),
  revision integer not null default 1,
  check ((min_amount is null) = (currency is null))
);

create table cart_reminder_step (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references cart_reminder_flow (store_id),
  position integer not null check (position between 1 and 3),
  enabled boolean not null,
  delay_minutes integer not null check (delay_minutes between 30 and 10080),
  channel text not null check (channel in ('email', 'whatsapp')),
  subject text not null check (char_length(subject) <= 120),
  body text not null check (char_length(body) <= 500),
  discount_bps integer check (discount_bps between 100 and 5000),
  unique (store_id, position)
);
create unique index cart_reminder_step_id_store_key on cart_reminder_step (id, store_id);

-- A reminder's own code is bound to its cart (and shopper), and holds no batch; the cart's going takes it.
alter table promotion add column cart_reminder boolean not null default false;
alter table promotion_code
  add column order_id uuid,
  add column customer_id uuid,
  add constraint promotion_code_order_fkey foreign key (order_id, store_id) references "order" (id, store_id) on delete cascade,
  add constraint promotion_code_customer_fkey foreign key (customer_id, store_id) references customer (id, store_id),
  drop constraint promotion_code_check,
  add constraint promotion_code_single_use_check check (not single_use or batch_id is not null or order_id is not null);

create table cart_reminder (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  -- Null for one sent by hand (sent_by_user_id).
  step_id uuid,
  sent_by_user_id uuid references "user" (id) on delete set null,
  channel text check (channel in ('email', 'whatsapp')),
  state text not null default 'queued' check (state in ('queued', 'sent', 'skipped')),
  skip_reason text check (skip_reason in ('cart_gone', 'stopped', 'recovered', 'paused', 'no_contact', 'opted_out', 'undeliverable', 'out_of_stock', 'under_minimum', 'weekly_cap', 'no_shop_host')),
  promotion_code_id uuid,
  -- The return and unsubscribe link's token, hashed, set as it is sent (ACCESS §6.1); never selected by a request role.
  link_token_hash text unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  queued_at timestamptz(3) not null default now(),
  sent_at timestamptz(3),
  clicked_at timestamptz(3),
  check ((state = 'skipped') = (skip_reason is not null)),
  foreign key (order_id, store_id) references "order" (id, store_id) on delete cascade,
  foreign key (step_id, store_id) references cart_reminder_step (id, store_id),
  foreign key (promotion_code_id, store_id) references promotion_code (id, store_id) on delete set null (promotion_code_id)
);
-- Each step once a cart, whichever sweep gets there first.
create unique index cart_reminder_step_once on cart_reminder (order_id, step_id) where step_id is not null;
create index cart_reminder_order_idx on cart_reminder (order_id, queued_at);
create index cart_reminder_sent_idx on cart_reminder (store_id, sent_at desc) where sent_at is not null;
alter table "order" add constraint order_recovered_by_reminder_fkey foreign key (recovered_by_reminder_id) references cart_reminder (id) on delete set null;

grant select, insert, update, delete on cart_reminder_flow, cart_reminder_step, cart_reminder to app_system;
grant select on cart_reminder_flow, cart_reminder_step to app_request;
grant insert (store_id, enabled, min_amount, currency, skip_out_of_stock, quiet_hours, weekly_cap) on cart_reminder_flow to app_request;
grant update (enabled, min_amount, currency, skip_out_of_stock, quiet_hours, weekly_cap, updated_at, revision) on cart_reminder_flow to app_request;
grant insert (store_id, position, enabled, delay_minutes, channel, subject, body, discount_bps) on cart_reminder_step to app_request;
grant update (enabled, delay_minutes, channel, subject, body, discount_bps) on cart_reminder_step to app_request;
grant select (id, store_id, order_id, step_id, sent_by_user_id, channel, state, skip_reason, promotion_code_id, queued_at, sent_at, clicked_at)
  on cart_reminder to app_request;
grant select (cart_reminder) on promotion to app_request;
grant select (order_id, customer_id) on promotion_code to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['cart_reminder_flow', 'cart_reminder_step', 'cart_reminder'] loop
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
  foreach t in array array['cart_reminder_flow', 'cart_reminder_step'] loop
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = ''''
        and app_setting_text(''app.support'') <> ''read'')', t || '_merchant', t);
  end loop;
end
$$;
-- The sent reminders are the engine's: the merchant side reads them only.
create policy cart_reminder_merchant on cart_reminder for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
