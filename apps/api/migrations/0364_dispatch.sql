-- DL 5 (#842): dispatch rounds and the latest rider position (DATA-MODEL §3.6, §7.12).
alter table rider add constraint rider_id_store_key unique (id, store_id);
alter table rider add column last_position_at timestamptz;
create table delivery (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references store(id),
  order_id uuid not null, warehouse_id uuid not null,
  state text not null check (state in ('packing','searching','unassigned','assigned','picked_up','delivered','failed','cancelled')),
  rider_id uuid, fulfilment_id uuid references fulfilment(id), cash_due_amount bigint check (cash_due_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'), cash_collected_at timestamptz, failed_reason text,
  offer_round integer not null default 0 check (offer_round >= 0), excluded_rider_id uuid,
  handover_code_enc text, code_attempts integer not null default 0, code_unconfirmed_at timestamptz,
  ready_at timestamptz, searching_at timestamptz, unassigned_at timestamptz, assigned_at timestamptz, picked_up_at timestamptz,
  delivered_at timestamptz, failed_at timestamptz, cancelled_at timestamptz, eta_at timestamptz, eta_computed_at timestamptz,
  created_at timestamptz not null default now(), revision integer not null default 1,
  unique(id, store_id), foreign key(order_id, store_id) references "order"(id, store_id),
  foreign key(warehouse_id, store_id) references warehouse(id, store_id),
  foreign key(rider_id, store_id) references rider(id, store_id),
  foreign key(excluded_rider_id, store_id) references rider(id, store_id)
);
create unique index delivery_open_order_key on delivery(order_id) where state not in ('failed','cancelled');
create index delivery_search_idx on delivery(store_id, state, searching_at);
create index delivery_rider_idx on delivery(rider_id, state);
create index delivery_order_idx on delivery(store_id, order_id, created_at desc, id desc);
create table delivery_offer (
  id uuid primary key default gen_random_uuid(), delivery_id uuid not null, store_id uuid not null references store(id),
  offer_round integer not null, rider_id uuid not null, distance_m double precision not null check(distance_m >= 0),
  sent_at timestamptz not null, answer text check(answer in ('accepted','declined','taken','expired')), answered_at timestamptz,
  foreign key(delivery_id, store_id) references delivery(id, store_id),
  foreign key(rider_id, store_id) references rider(id, store_id), unique(delivery_id, offer_round, rider_id)
);
create index delivery_offer_rider_idx on delivery_offer(rider_id, answer, sent_at desc, id desc);
create table rider_position (
  rider_id uuid primary key, store_id uuid not null references store(id),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision not null check(accuracy_m >= 0 and accuracy_m < 'Infinity'::float8),
  reported_at timestamptz not null, received_at timestamptz not null,
  foreign key(rider_id, store_id) references rider(id, store_id)
);
create index rider_position_expiry_idx on rider_position(received_at);
do $$ declare t text; begin
  foreach t in array array['delivery','delivery_offer','rider_position'] loop
    execute format('alter table %I enable row level security',t);
    execute format('alter table %I force row level security',t);
    execute format('grant select, insert, update, delete on %I to app_system',t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy merchant_select on %I for select to app_request using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')',t);
    execute format('create policy rider_select on %I for select to app_rider using (app_setting_text(''app.scope'') = ''delivery'' and store_id = app_setting_uuid(''app.store_id'') and rider_id = app_setting_uuid(''app.rider_id''))',t);
  end loop;
end $$;
grant select on delivery_offer, rider_position to app_request, app_rider;
-- Not the handover code or its attempt count: only the engine reads those (DELIVERY §3).
grant select (id, store_id, order_id, warehouse_id, state, rider_id, fulfilment_id, cash_due_amount, currency, cash_collected_at, failed_reason,
  offer_round, excluded_rider_id, code_unconfirmed_at, ready_at, searching_at, unassigned_at, assigned_at, picked_up_at, delivered_at,
  failed_at, cancelled_at, eta_at, eta_computed_at, created_at, revision) on delivery to app_request, app_rider;
grant insert (store_id, order_id, warehouse_id, state, offer_round, currency, cash_due_amount, searching_at, created_at) on delivery to app_request;
grant update (state, rider_id, excluded_rider_id, offer_round, searching_at, ready_at, unassigned_at, assigned_at, cancelled_at, revision) on delivery to app_request;
grant update (answer, answered_at) on delivery_offer to app_request;
-- A read-only support session writes nothing, as 0359's rider policies (DATA-MODEL §5.2).
create policy merchant_insert on delivery for insert to app_request
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy merchant_update on delivery for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy merchant_update on delivery_offer for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
