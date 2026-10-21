-- SAPI 12 (#311), part 1: a label booked through the store's courier on its partner's account, and the courier's pickup
-- (DATA-MODEL §7.6 fulfilment and order_document; THIRD-PARTY-ACCESS §3.2, §4). Written by the engine in system scope.

alter table fulfilment drop constraint fulfilment_kind_check;
alter table fulfilment add constraint fulfilment_kind_check check (kind in ('booked', 'manual', 'sent_to_store', 'pickup'));

alter table fulfilment
  -- The store's courier it went through (store_courier.provider), and the courier's own id for the parcel.
  add column courier_provider text check (courier_provider in ('shiprocket', 'usps', 'ups', 'fedex')),
  add column provider_ref text check (char_length(provider_ref) between 1 and 100),
  add column booked_at timestamptz,
  add column pickup_requested_at timestamptz,
  add column pickup_ref text check (char_length(pickup_ref) between 1 and 100),
  add column pickup_date date,
  add constraint fulfilment_booked check (
    (kind = 'booked') = (courier_provider is not null and provider_ref is not null and booked_at is not null)
    and (kind <> 'booked' or tracking_number is not null)
  ),
  add constraint fulfilment_pickup_asked check (pickup_requested_at is not null or (pickup_ref is null and pickup_date is null));
create unique index fulfilment_provider_ref_key on fulfilment (courier_provider, provider_ref) where provider_ref is not null;

-- Every printable of an order, kept as an asset so it never changes (DATA-MODEL §7.6); labels only for now, the
-- invoice, packing slip and return label joining with their cards. seller_id is the label's supplier, so it reads its own.
create table order_document (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  kind text not null check (kind in ('label')),
  asset_id uuid not null,
  fulfilment_id uuid references fulfilment (id),
  issued_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (asset_id, store_id) references asset (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id),
  constraint order_document_label check (kind <> 'label' or fulfilment_id is not null)
);
create unique index order_document_label_key on order_document (fulfilment_id) where kind = 'label';
create index order_document_order_idx on order_document (order_id, issued_at);

grant select, insert on order_document to app_system;
grant select on order_document to app_request, app_supplier;

alter table order_document enable row level security;
alter table order_document force row level security;
create policy order_document_system on order_document for all to app_system using (true) with check (true);
create policy order_document_merchant on order_document for select to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy order_document_supplier on order_document for select to app_supplier
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and seller_id = app_setting_uuid('app.seller_id'));
create policy request_scope on order_document as restrictive for all to app_request, app_supplier
  using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on order_document as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on order_document as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on order_document as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
