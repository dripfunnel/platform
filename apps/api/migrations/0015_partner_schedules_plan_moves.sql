-- The partner writes only the schedule of its own stores' subscriptions (DATA-MODEL §2.4, #161).
grant update (next_plan_id, next_plan_version, change_at) on store_subscription to app_partner;
