-- A shopper's optional map pin on a saved address (#814): both or neither, in range. The cart and order keep theirs in
-- shipping_address's JSON. Nullable, so the previous release's inserts still work. The merchant side never reads it, and
-- writes it only to clear it when it moves a default address (db/scoped/storeCustomers.ts).
alter table customer_address
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint customer_address_pin_whole check ((latitude is null) = (longitude is null));

grant select (latitude, longitude), insert (latitude, longitude), update (latitude, longitude) on customer_address to app_shop;
grant update (latitude, longitude) on customer_address to app_request;
