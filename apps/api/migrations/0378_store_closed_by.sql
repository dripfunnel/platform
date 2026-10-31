-- Who archived a store (#1056; SAAS §4.2 Closed, shown as Archived): the staff member's or the partner's name, as
-- suspended_by_label is for a suspension. closed_at already holds when.
alter table store add column closed_by_label text;

-- A partner never writes a subscription's status itself; archiving ends it only on its own store, once that store is Closed.
create function partner_end_subscription(p_store uuid, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'partner' then
    raise exception 'partner_end_subscription: partner scope only' using errcode = 'insufficient_privilege';
  end if;
  update store_subscription sub set status = 'cancelled', cancel_at = least(coalesce(sub.cancel_at, p_at), p_at),
    next_plan_id = null, next_plan_version = null, next_interval = null, change_at = null, billing_revision = sub.billing_revision + 1
  from store s
  where s.id = sub.store_id and sub.store_id = p_store and s.partner_id = app_setting_uuid('app.partner_id')
    and s.status = 'closed' and sub.status <> 'cancelled';
end
$$;

alter function partner_end_subscription(uuid, timestamptz) owner to app_definer;
revoke all on function partner_end_subscription(uuid, timestamptz) from public;
grant execute on function partner_end_subscription(uuid, timestamptz) to app_partner;
