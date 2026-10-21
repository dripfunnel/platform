-- #518: previews move to {key}.webpreview.store (storefront PREVIEW.md §1, §2 step 5), and the partner "preview" address is retired.
-- Plan:
--   1. storefront.preview_key: 10 lowercase base32 characters, unique across the platform, made by the database with the store.
--      Every existing storefront gets one here; storefront_for_store() sets it for new stores, drawing again on a clash.
--   2. Every partner_domain row of kind 'preview' and its partner_domain_record rows are deleted. No such host was ever registered
--      with Cloudflare (domain.recheck registers portal hosts only), so nothing outside this database refers to them, and no
--      partner is emailed. A queued "address live" email for one finds no address and is skipped (saas/email/compose.ts).
--   3. partner_domain.kind's check narrows to portal, shops and email, so no preview row can come back.
-- partner_setup_item's 'wildcards' item keeps its key; it now follows the shops address alone (saas/partnerConsole).
-- Between this migration and the promotion of the build that ships with it (ARCHITECTURE §6), the old build still runs.
-- The window is harmless:
--   - Adding a preview address fails on the narrowed check, as a 500 rather than INVALID_INPUT. Such an address never did
--     anything: no preview host was registered or served.
--   - The old build's {code}.preview.<partner domain> lookup finds nothing. No traffic reached those hosts.
--   - The old build's store page shows no preview address, its queued live-address emails for a preview find no address and
--     are skipped, and its store inserts get a key from the new trigger.

-- Base32 (RFC 4648, lowercase) from a v4 UUID's random bytes; bytes 6 and 8 carry its version and variant, so they are skipped.
create function new_preview_key() returns text
language sql
volatile
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz234567', get_byte(b, i) % 32 + 1, 1), '' order by n)
  from (select uuid_send(gen_random_uuid()) as b) u, unnest(array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11]) with ordinality as k(i, n)
$$;
revoke execute on function new_preview_key() from public;
grant execute on function new_preview_key() to app_definer;

alter table storefront add column preview_key text check (preview_key ~ '^[a-z2-7]{10}$');
create unique index storefront_preview_key_key on storefront (preview_key);

do $$
declare
  s uuid;
begin
  for s in select store_id from storefront loop
    loop
      begin
        update storefront set preview_key = new_preview_key() where store_id = s;
        exit;
      exception when unique_violation then
        -- Another storefront drew the same key: draw again.
      end;
    end loop;
  end loop;
end
$$;

alter table storefront alter column preview_key set not null;

create or replace function storefront_for_store() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clashed text;
begin
  for attempt in 1..5 loop
    begin
      insert into storefront (store_id, public_store_key, preview_key)
      values (new.id, 'pk_' || replace(gen_random_uuid()::text, '-', ''), new_preview_key());
      return new;
    exception when unique_violation then
      get stacked diagnostics clashed = constraint_name;
      if clashed <> 'storefront_preview_key_key' or attempt = 5 then
        raise;
      end if;
    end;
  end loop;
  return new;
end
$$;

delete from partner_domain_record r using partner_domain d where r.domain_id = d.id and d.kind = 'preview';
delete from partner_domain where kind = 'preview';

alter table partner_domain drop constraint partner_domain_kind_check;
alter table partner_domain add constraint partner_domain_kind_check check (kind in ('portal', 'shops', 'email'));
