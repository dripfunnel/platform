-- SAPI 5 (#295), part 2: the merchant's Suppliers tab (ACCESS §5.2, §7.5; DATA-MODEL §4.2): a supplier's
-- shipping mode, who books its labels, suspension and removal.

alter table seller
  add column shipping_mode text not null default 'to-store' check (shipping_mode in ('to-store', 'to-shopper')),
  -- A to-shopper supplier books labels through the store's courier account or its own (#337).
  add column label_account text not null default 'store' check (label_account in ('store', 'own')),
  add column suspended_at timestamptz,
  -- The Owner's choice at suspension: hide the supplier's products, or keep selling from stock in hand.
  add column hide_products_while_suspended boolean,
  add column removed_at timestamptz,
  add constraint seller_status_check check (status in ('invited', 'active', 'suspended', 'removed')),
  add constraint seller_name_length check (char_length(name) between 1 and 120);

-- One live supplier of a name per store, whatever its case; a removed one frees it.
create unique index seller_name_key on seller (store_id, lower(name)) where status <> 'removed';

-- Accepting a supplier's first invitation runs as the system and makes the supplier active (ACCESS §7.5).
create policy seller_system_update on seller for update to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
