-- The store actions a partner takes on its own stores (ui/platform/FIRST-RELEASE.md §6.4; #160).

-- A plan change "now" leaves what it prorates for billing (#201) to collect: minor units in the
-- subscription's currency, a charge above zero and a credit below (DATA-MODEL §7.9).
alter table store_subscription
  add column proration_amount integer,
  add column proration_at timestamptz(3),
  add constraint store_subscription_proration check ((proration_amount is null) = (proration_at is null));

grant select (proration_amount, proration_at) on store_subscription to app_partner;
grant update (trial_ends_at) on store_subscription to app_partner;

-- A partner never writes a subscription's plan, amount or proration directly; this moves its own
-- store to a Live plan's current version at that version's price (DATA-MODEL §2.4).
create function partner_move_subscription(p_store uuid, p_plan uuid, p_proration integer, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sub store_subscription;
  target plan;
  price integer;
begin
  if app_setting_text('app.scope') <> 'partner' then
    raise exception 'partner_move_subscription: partner scope only' using errcode = 'insufficient_privilege';
  end if;
  select * into sub from store_subscription where store_id = p_store and partner_id = app_setting_uuid('app.partner_id') for update;
  select * into target from plan where id = p_plan and partner_id = app_setting_uuid('app.partner_id') and status = 'live';
  if sub.store_id is null or target.id is null then
    raise exception 'partner_move_subscription: no such store or Live plan' using errcode = 'no_data_found';
  end if;
  select case when sub.interval = 'year' then yearly_amount else monthly_amount end into price
  from plan_price where plan_id = target.id and version = target.version and currency = sub.currency;
  if price is null then
    raise exception 'partner_move_subscription: the plan has no price in %', sub.currency using errcode = 'check_violation';
  end if;
  -- The service prorates to the millisecond; the database holds it to the difference's sign and size.
  if (sub.status = 'trial' and p_proration <> 0) or sign(p_proration) not in (0, sign(price - sub.amount)) or abs(p_proration) > abs(price - sub.amount) then
    raise exception 'partner_move_subscription: proration outside the price difference' using errcode = 'check_violation';
  end if;
  update store_subscription set plan_id = target.id, plan_version = target.version, amount = price,
    next_plan_id = null, next_plan_version = null, change_at = null,
    proration_amount = case when p_proration = 0 then proration_amount else coalesce(proration_amount, 0) + p_proration end,
    proration_at = case when p_proration = 0 then proration_at else p_at end
  where store_id = p_store;
end
$$;

grant select, update on store_subscription to app_definer;
grant select on plan, plan_price to app_definer;
alter function partner_move_subscription(uuid, uuid, integer, timestamptz) owner to app_definer;
revoke all on function partner_move_subscription(uuid, uuid, integer, timestamptz) from public;
grant execute on function partner_move_subscription(uuid, uuid, integer, timestamptz) to app_partner;

-- Resend owner invitation: a fresh owner invitation on its own store and the old one revoked,
-- never a team member's or a supplier's, and never the token (the deliverer's, as app_system).
grant insert (store_id, email, role_key, expires_at, invited_by_label) on invitation to app_partner;
grant update (revoked_at) on invitation to app_partner;

create policy invitation_partner_insert on invitation for insert to app_partner
with check (app_setting_text('app.scope') = 'partner' and seller_id is null and role_key = 'owner' and store_id in (select id from store));

create policy invitation_partner_update on invitation for update to app_partner
using (app_setting_text('app.scope') = 'partner' and seller_id is null and role_key = 'owner' and store_id in (select id from store))
with check (app_setting_text('app.scope') = 'partner' and seller_id is null and role_key = 'owner' and store_id in (select id from store));

-- Retry this step: only the latest setup job of its own store, failed or running (whether a
-- running step is stuck is the service's, from SAAS §5's limits), and only back to running.
grant update (state, step_started_at, attempts, finished_at, last_error) on job to app_partner;

-- A policy on job can't read job without recursing, so the latest is found by the definer.
create function latest_job_of(p_store uuid) returns uuid
language sql stable security definer set search_path = public
as $$
  select j.id from job j join store s on s.id = j.store_id
  where j.store_id = p_store and s.partner_id = app_setting_uuid('app.partner_id')
  order by j.started_at desc limit 1
$$;

grant select on job, store to app_definer;
alter function latest_job_of(uuid) owner to app_definer;
revoke all on function latest_job_of(uuid) from public;
grant execute on function latest_job_of(uuid) to app_partner;

create policy job_partner_retry on job for update to app_partner
using (
  app_setting_text('app.scope') = 'partner' and store_id in (select id from store) and state in ('failed', 'running')
  and id = latest_job_of(store_id)
)
with check (app_setting_text('app.scope') = 'partner' and store_id in (select id from store) and state = 'running');
