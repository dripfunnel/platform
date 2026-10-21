-- #719: the Owner skips "Choose how shoppers pay" and "Choose how you ship" on Home's checklist (DATA-MODEL §7.2).
-- A skipped step leaves the checklist's count; the list still goes at the first order. Written through the definer below
-- alone, as save_store_info is: the merchant side of a store, never a supplier or a read-only support session.
alter table store add column setup_skipped text[] not null default '{}' check (setup_skipped <@ array['payments', 'shipping']);

create function set_setup_step_skipped(step text, skipped boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_setup_step_skipped: the merchant side of a store only' using errcode = '42501';
  end if;
  update store set setup_skipped = case when skipped then array_append(array_remove(setup_skipped, step), step) else array_remove(setup_skipped, step) end
  where id = app_setting_uuid('app.store_id');
end
$$;
grant select (id, setup_skipped) on store to app_definer;
grant update (setup_skipped) on store to app_definer;
alter function set_setup_step_skipped(text, boolean) owner to app_definer;
revoke execute on function set_setup_step_skipped(text, boolean) from public;
grant execute on function set_setup_step_skipped(text, boolean) to app_request;
