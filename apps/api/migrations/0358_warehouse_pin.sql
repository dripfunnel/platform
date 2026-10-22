-- A location's optional map pin (#815): both or neither, in range, sent to a courier that takes coordinates
-- (THIRD-PARTY-ACCESS §3.2). Nullable, so the previous release's inserts and updates still work.
alter table warehouse
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint warehouse_pin_whole check ((latitude is null) = (longitude is null));

-- Both roles already select and insert the whole table; 0047 copied app_request's column grants to app_supplier once.
grant update (latitude, longitude) on warehouse to app_request, app_supplier;
