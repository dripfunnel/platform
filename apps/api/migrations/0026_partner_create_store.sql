-- A partner creates a store for a merchant it signed (ui/platform/FIRST-RELEASE.md §6.2; #221):
-- the store, its Owner (invited), the subscription on a Live plan and the setup job, in the
-- partner's own scope. Each insert is granted by column and held by a policy to exactly that.

grant insert (partner_id, email, name, status) on "user" to app_partner;
create policy user_partner_invites on "user" for insert to app_partner
  with check (partner_id = app_setting_uuid('app.partner_id') and status = 'invited');

grant insert (user_id, store_id, role_key, status) on membership to app_partner;
-- One of the partner's own people, as the store's first and only Owner. A definer function, as
-- 0018's latest_job_of: the policies of "user" and membership read each other, so a subquery recurses.
create function partner_may_add_owner(p_store uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from store where id = p_store and partner_id = app_setting_uuid('app.partner_id'))
    and exists (select 1 from "user" where id = p_user and partner_id = app_setting_uuid('app.partner_id'))
    and not exists (select 1 from membership where store_id = p_store and seller_id is null and role_key = 'owner')
$$;
alter function partner_may_add_owner(uuid, uuid) owner to app_definer;
revoke all on function partner_may_add_owner(uuid, uuid) from public;
grant execute on function partner_may_add_owner(uuid, uuid) to app_partner;

create policy membership_partner_owner on membership for insert to app_partner
  with check (seller_id is null and role_key = 'owner' and status = 'invited' and partner_may_add_owner(store_id, user_id));

-- The first job of a store only: a later one is staff's or the retry's (0018).
grant insert (store_id, kind, state, steps, step, step_started_at, started_at, finished_at) on job to app_partner;
create policy job_partner_first on job for insert to app_partner
  with check (kind = 'provision-store' and store_id in (select id from store) and latest_job_of(store_id) is null);

-- At the plan's current version and its own monthly price in the currency, never an amount the
-- request chose; a trial or active, nothing else.
grant insert (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at)
  on store_subscription to app_partner;
create policy store_subscription_partner_new on store_subscription as restrictive for insert to app_partner
  with check (
    status in ('trial', 'active') and interval = 'month'
    and plan_version = (select p.version from plan p where p.id = plan_id and p.status = 'live')
    and amount = (select pp.monthly_amount from plan_price pp where pp.plan_id = store_subscription.plan_id and pp.version = plan_version and pp.currency = store_subscription.currency)
  );

-- The accounts export (FIRST-RELEASE §6.1), the same job as the activity and report exports.
alter table export_job drop constraint export_job_kind_check;
alter table export_job add constraint export_job_kind_check check (kind in ('activity', 'report', 'stores'));
