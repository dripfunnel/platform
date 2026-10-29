-- DL 18 (#874): a rider's data exported by the Owner and erased (api/DELIVERY.md §5; DATA-MODEL §2.6, §3.6; LOGGING §8).

-- The export is one of the store's jobs (0058), read back by id.
alter table catalog_export drop constraint catalog_export_kind_check;
alter table catalog_export add constraint catalog_export_kind_check check (kind in ('products', 'stock', 'orders', 'customers', 'offer_codes', 'report', 'activity', 'rider'));

-- The file holds the rider's sign-in times, read in the Owner's own scope.
grant select (created_at, last_seen_at) on rider_session to app_request;

-- Erasing a rider replaces their name in the log's labels. The log stays append-only for every role: this function, run by the
-- erasure in system scope, may change those two columns and only on entries that name the rider.
grant select (store_id, target_type, target_id, actor_kind, actor_id, target_label, actor_label), update (target_label, actor_label) on activity_log to app_definer;

create function erase_rider_labels(p_store uuid, p_rider uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  named integer;
  acted integer;
begin
  update activity_log set target_label = 'Former rider'
  where store_id = p_store and target_type = 'rider' and target_id = p_rider::text and target_label <> 'Former rider';
  get diagnostics named = row_count;
  update activity_log set actor_label = 'Former rider'
  where store_id = p_store and actor_kind = 'rider' and actor_id = p_rider::text and actor_label <> 'Former rider';
  get diagnostics acted = row_count;
  return named + acted;
end
$$;
alter function erase_rider_labels(uuid, uuid) owner to app_definer;
revoke execute on function erase_rider_labels(uuid, uuid) from public;
grant execute on function erase_rider_labels(uuid, uuid) to app_system;
