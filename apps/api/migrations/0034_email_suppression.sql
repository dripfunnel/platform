-- Email through Amazon SES (THIRD-PARTY-ACCESS §2.4, #274): the addresses SES reported as a
-- permanent bounce or a complaint, never sent to again. Kept as a SHA-256 of the lower-cased
-- address, so the list holds no personal data and survives an erasure request unchanged.

create table email_suppression (
  address_hash text primary key check (address_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('bounce', 'complaint')),
  suppressed_at timestamptz(3) not null default now()
);

grant select, insert, update on email_suppression to app_system;

alter table email_suppression enable row level security;
alter table email_suppression force row level security;
create policy request_scope on email_suppression as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on email_suppression as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on email_suppression as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on email_suppression as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
-- Only the email deliverer and the SES hook, both system work, read or write it.
create policy email_suppression_system on email_suppression for all to app_system using (true) with check (true);
