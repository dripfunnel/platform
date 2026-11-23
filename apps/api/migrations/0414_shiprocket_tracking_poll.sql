-- Shiprocket tracking is also asked for, in case a parcel's hook never comes (THIRD-PARTY-ACCESS §3.2; DATA-MODEL §7.6):
-- when a booked parcel still on its way, or delivered awaiting its cash on delivery, was last asked. Backward-compatible.

alter table fulfilment add column tracking_polled_at timestamptz;

create index fulfilment_tracking_poll_idx on fulfilment (tracking_polled_at nulls first)
  where kind = 'booked' and courier_provider = 'shiprocket' and delivered_at is null;

-- A delivered parcel is asked about its cash on delivery's remittance until its order is paid.
create index fulfilment_cash_poll_idx on fulfilment (tracking_polled_at nulls first)
  where kind = 'booked' and courier_provider = 'shiprocket' and tracking_status = 'delivered';
