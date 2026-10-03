-- A partner schedules its own stores' move to another plan version (SAAS §6.3; #161), in the
-- same transaction as the plan change and its activity entry. It writes only the schedule:
-- what a store pays now stays billing's (DATA-MODEL §2.4). The composite keys of 0014 keep the
-- target one of the partner's own plans.
grant update (next_plan_id, next_plan_version, change_at) on store_subscription to app_partner;
