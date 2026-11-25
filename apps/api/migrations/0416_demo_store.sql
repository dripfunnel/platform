-- A category template's demo store (admin FIRST-RELEASE §11d, DATA-MODEL §7.2): hidden, under DripFunnel's own partner,
-- holding only the demo data a template's preview shows. Never a partner's to see, never billed, never published.

alter table store add column if not exists is_demo boolean not null default false;

create or replace function store_demo_check() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.is_demo is distinct from old.is_demo then
    raise exception 'store.is_demo is set once, at insert' using errcode = 'check_violation';
  end if;
  -- Nested so the partner read is planned only for a demo store: every other insert never touches it.
  if new.is_demo then
    if not exists (select 1 from partner p where p.id = new.partner_id and p.is_house) then
      raise exception 'a demo store belongs to the house partner' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists store_demo_check on store;
create trigger store_demo_check before insert or update of is_demo, partner_id on store for each row execute function store_demo_check();

create or replace function storefront_template_demo_check() returns trigger language plpgsql as $$
begin
  if new.demo_store_id is not null and not exists (select 1 from store s where s.id = new.demo_store_id and s.is_demo) then
    raise exception 'a template''s demo is a demo store' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists storefront_template_demo_check on storefront_template;
create trigger storefront_template_demo_check before insert or update of demo_store_id on storefront_template
  for each row execute function storefront_template_demo_check();

create unique index if not exists storefront_template_demo_key on storefront_template (demo_store_id) where demo_store_id is not null;

-- No partner or staff list, count or search ever holds a demo store; the Admin API reads its template's demo in system
-- scope (the house partner's console included).
drop policy if exists store_not_demo on store;
create policy store_not_demo on store as restrictive for all to app_partner, app_platform using (not is_demo) with check (not is_demo);
