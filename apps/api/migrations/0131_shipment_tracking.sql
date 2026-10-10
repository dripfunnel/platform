-- SAPI 12 (#311), part 2: a booked parcel's tracking from its courier's hook (DATA-MODEL §7.6 fulfilment), applied in
-- system scope and only forward in time, so a hook delivered twice or late changes nothing.

alter table fulfilment
  add column tracking_status text check (tracking_status in ('in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'cancelled')),
  -- The courier's time for the status, which a later hook must pass to replace it.
  add column tracking_status_at timestamptz,
  add constraint fulfilment_tracked check ((tracking_status is null) = (tracking_status_at is null) and (tracking_status is null or kind = 'booked'));

-- Shiprocket's hook names the parcel by its tracking number (EasyPost's by provider_ref, already unique).
create index fulfilment_booked_tracking_idx on fulfilment (courier_provider, tracking_number) where kind = 'booked';
