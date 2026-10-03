-- Each partner address's DNS records (ui/platform/FIRST-RELEASE.md §9; SAAS §3.5–3.6; #197): the
-- portal's CNAME, or an A record for a root domain; a wildcard's CNAME; the email sender's SPF,
-- DKIM and DMARC. The address is live once every record matches (SAAS §8).

alter table partner_domain drop constraint partner_domain_record_type_check;
alter table partner_domain add constraint partner_domain_record_type_check check (record_type in ('CNAME', 'TXT', 'A'));

create table partner_domain_record (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references partner_domain (id),
  partner_id uuid not null references partner (id),
  position integer not null check (position >= 0),
  purpose text not null check (purpose in ('pointer', 'ownership', 'spf', 'dkim', 'dmarc')),
  record_type text not null check (record_type in ('CNAME', 'TXT', 'A')),
  name text not null,
  expected text not null,
  found text,
  checked_at timestamptz,
  unique (domain_id, position)
);

create index partner_domain_record_partner_idx on partner_domain_record (partner_id, domain_id);

-- Every address built before this card has its one record as a row; the email sender's was SPF.
insert into partner_domain_record (domain_id, partner_id, position, purpose, record_type, name, expected, found, checked_at)
select id, partner_id, 0, case when kind = 'email' then 'spf' else 'pointer' end, record_type,
  case when host like '*.%' then 'df-probe.' || substr(host, 3) else host end, expected, found, checked_at
from partner_domain;

-- Claiming a host proves nothing until its ownership record (a token per address) is found, so
-- only an address past waiting or failed holds its host against every other partner's claim.
drop index partner_domain_host_key;
create unique index partner_domain_host_key on partner_domain (lower(host)) where status not in ('waiting', 'failed');
create index partner_domain_host_idx on partner_domain (lower(host));

-- A partner adds its own address and its records; only the check (app_system) and staff write a
-- status or what DNS returned, so a partner can no longer mark an address live itself.
revoke update on partner_domain from app_partner;
-- And what it inserts is waiting and unchecked: only the check moves an address on.
create policy partner_domain_partner_adds_waiting on partner_domain as restrictive for insert to app_partner
  with check (status = 'waiting' and found is null and checked_at is null);
grant select, insert on partner_domain_record to app_partner;
grant select, insert, update on partner_domain_record to app_platform, app_system;

alter table partner_domain_record enable row level security;
alter table partner_domain_record force row level security;
create policy request_scope on partner_domain_record as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on partner_domain_record as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on partner_domain_record as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_domain_record as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy partner_domain_record_partner on partner_domain_record for all to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy partner_domain_record_staff on partner_domain_record for all to app_platform, app_system
  using (true) with check (true);

-- A record belongs to its address's partner: foreign keys skip RLS, so the trigger checks it.
create function partner_domain_record_owner() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from partner_domain where id = new.domain_id and partner_id = new.partner_id) then
    raise exception 'partner_domain_record: the address belongs to another partner' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger partner_domain_record_owner before insert or update on partner_domain_record
for each row execute function partner_domain_record_owner();

grant select on partner_domain to app_definer;
alter function partner_domain_record_owner() owner to app_definer;
revoke all on function partner_domain_record_owner() from public;

-- Whether another partner already holds a host (live, or past waiting and failed): the add flow's
-- HOST_TAKEN, answered without saying whose. A definer, since RLS hides other partners' rows.
create function partner_host_claimed(p_host text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from partner_domain
    where lower(host) = lower(p_host) and status not in ('waiting', 'failed')
      and partner_id is distinct from app_setting_uuid('app.partner_id')
  )
$$;

alter function partner_host_claimed(text) owner to app_definer;
revoke all on function partner_host_claimed(text) from public;
grant execute on function partner_host_claimed(text) to app_partner;
