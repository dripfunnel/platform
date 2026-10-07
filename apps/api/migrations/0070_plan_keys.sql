-- Every plan setting is one row of plan_key, so a new setting is an insert, not a rewrite of four
-- check lists (card #458; SAAS.md §6.1). The keys and their kinds are src/db/scoped/planKeys.ts.
create table plan_key (
  key text primary key,
  kind text not null check (kind in ('switch', 'amount', 'choice'))
);
insert into plan_key (key, kind) values
  ('products', 'amount'),
  ('photos_per_product', 'amount'),
  ('versions_per_product', 'amount'),
  ('collections', 'amount'),
  ('size_charts', 'switch'),
  ('badges', 'switch'),
  ('faqs_related', 'switch'),
  ('aplus', 'switch'),
  ('product_video', 'switch'),
  ('import_spreadsheet', 'switch'),
  ('import_shopify', 'switch'),
  ('ai_mode', 'choice'),
  ('ai_prompts', 'amount'),
  ('payment_gateways', 'amount'),
  ('offers', 'switch'),
  ('group_offers', 'switch'),
  ('offer_results', 'switch'),
  ('staff', 'amount'),
  ('manager_role', 'switch'),
  ('suppliers_enabled', 'switch'),
  ('suppliers', 'amount'),
  ('supplier_approval', 'switch'),
  ('supplier_packing', 'switch'),
  ('markets', 'amount'),
  ('currencies', 'amount'),
  ('languages', 'amount'),
  ('price_adjustment', 'switch'),
  ('fixed_market_prices', 'switch'),
  ('market_domains', 'switch'),
  ('duties_taxes', 'switch'),
  ('stock_locations', 'amount'),
  ('couriers', 'amount'),
  ('courier_rates', 'switch'),
  ('bandwidth_gb', 'amount'),
  ('extra_bandwidth', 'switch'),
  ('custom_domain', 'switch'),
  ('powered_by_removal', 'switch'),
  ('publish_now', 'amount'),
  ('history_days', 'amount'),
  ('cart_reminders', 'choice'),
  ('blog', 'switch'),
  ('reports_sales', 'switch'),
  ('reports_export', 'switch'),
  ('reports_custom', 'switch'),
  ('support_level', 'choice'),
  ('uptime_guarantee', 'switch'),
  ('white_label', 'switch'),
  ('many_stores', 'switch'),
  ('sso_api', 'switch'),
  ('onboarding', 'switch');
grant select on plan_key to app_partner, app_platform, app_request, app_system, app_definer;

alter table plan_entitlement drop constraint plan_entitlement_key_check;
alter table plan_entitlement drop constraint plan_entitlement_kind;
alter table plan_entitlement add constraint plan_entitlement_key_fkey foreign key (key) references plan_key (key);
alter table plan_ceiling drop constraint plan_ceiling_key_check;
alter table plan_ceiling add constraint plan_ceiling_key_fkey foreign key (key) references plan_key (key);
alter table store_limit_override drop constraint store_limit_override_key_check;
alter table store_limit_override add constraint store_limit_override_key_fkey foreign key (key) references plan_key (key);
alter table store_usage drop constraint store_usage_key_check;
alter table store_usage add constraint store_usage_key_fkey foreign key (key) references plan_key (key);

-- A switch holds `enabled`, a limit, an allowance or a choice holds `amount`; the kind is plan_key's.
create function plan_entitlement_kind_guard() returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
begin
  select kind into k from plan_key where key = new.key;
  if k = 'switch' and (new.enabled is null or new.amount is not null) then
    raise exception 'plan_entitlement_kind: % is a switch', new.key using errcode = 'check_violation';
  end if;
  if k <> 'switch' and (new.amount is null or new.enabled is not null) then
    raise exception 'plan_entitlement_kind: % holds an amount', new.key using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger plan_entitlement_kind before insert on plan_entitlement
for each row execute function plan_entitlement_kind_guard();

-- Plan versions written before these keys existed get one row per new key, off or zero: a Planned
-- row is never checked, so no store's plan starts refusing anything; the five switches the server
-- does check (the catalogue sections and the two imports) start on, as every store has them today.
insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount)
select v.plan_id, v.partner_id, v.version, k.key,
  case when k.kind = 'switch' then k.key in ('badges', 'faqs_related', 'product_video', 'import_spreadsheet', 'import_shopify') end,
  case when k.kind <> 'switch' then 0 end
from plan_version v
cross join plan_key k
where k.key not in ('custom_domain', 'offers', 'suppliers_enabled', 'powered_by_removal', 'aplus', 'size_charts', 'products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts')
on conflict do nothing;
