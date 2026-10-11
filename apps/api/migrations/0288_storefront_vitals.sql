-- INF 5 (#484): real-user Core Web Vitals, recorded only after the shopper's consent and kept per day (storefront
-- ARCHITECTURE §9, DATA-MODEL §7.8), and the regression rule's verdict on a build. Nothing here is destructive.

-- A day's samples per page kind and device as histograms, so the 75th percentile of any span of days can be read
-- (a p75 can't be summed); the bucket bounds are db/scoped/vitals.ts's. No visitor id, address or URL.
create table storefront_vitals_day (
  store_id uuid not null references store (id),
  day date not null,
  page_kind text not null check (page_kind in ('home', 'collection', 'product', 'custom', 'cart', 'checkout', 'other')),
  device text not null check (device in ('phone', 'desktop')),
  samples integer not null default 0 check (samples >= 0),
  lcp_hist integer[] not null,
  inp_hist integer[] not null,
  cls_hist integer[] not null,
  primary key (store_id, day, page_kind, device)
);

-- The regression rule's reading of a live build (ARCHITECTURE §9): its verdict and the measures it compared.
alter table publish_run add column vitals jsonb check (vitals is null or jsonb_typeof(vitals) = 'object');

grant select on storefront_vitals_day to app_request;
grant select, insert, update, delete on storefront_vitals_day to app_system;

alter table storefront_vitals_day enable row level security;
alter table storefront_vitals_day force row level security;
create policy storefront_vitals_day_system on storefront_vitals_day for all to app_system using (true) with check (true);
create policy storefront_vitals_day_merchant on storefront_vitals_day for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on storefront_vitals_day as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on storefront_vitals_day as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront_vitals_day as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on storefront_vitals_day as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
