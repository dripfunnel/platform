-- SAPI 5 (#295), part 4: approval of suppliers' products (ACCESS §7.2, CATALOG L). The store's switch, read by
-- a supplier through a definer function (it reads no store row), and 0041's guard deciding what a supplier's
-- save does with it, so no request can skip the queue.

alter table store add column vendor_products_require_approval boolean not null default false;

create function store_vendor_approval() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.vendor_products_require_approval from store s
    where app_setting_text('app.scope') = 'store' and s.id = app_setting_uuid('app.store_id')), false)
$$;
alter function store_vendor_approval() owner to app_definer;
revoke execute on function store_vendor_approval() from public;
grant execute on function store_vendor_approval() to app_request, app_supplier;

-- The merchant side changes the store row by no policy (its update grant is the partner's and staff's), so the
-- switch is this one column for the acting store; the API holds it to the Owner (`approve`).
create function set_store_vendor_approval(required boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_store_vendor_approval: the merchant side of a store only' using errcode = '42501';
  end if;
  update store set vendor_products_require_approval = required where id = app_setting_uuid('app.store_id');
end
$$;
grant update (vendor_products_require_approval) on store to app_definer;
alter function set_store_vendor_approval(boolean) owner to app_definer;
revoke execute on function set_store_vendor_approval(boolean) from public;
grant execute on function set_store_vendor_approval(boolean) to app_request;

-- As 0041's, and while approval is on a supplier's new product is made hidden and pending whatever it sent; its
-- one approval change is sending its own product back to the queue (a reviewed field changed, or resubmitting).
-- A Stock-only supplier's product is always a proposal, and it changes no product row after (decided on #337).
-- The acting supplier's tier, from its own seller row (which its policy lets it read).
create function supplier_tier() returns text
language sql
stable
as $$
  select access_level from seller where id = nullif(app_setting_text('app.seller_id'), '')::uuid
$$;

create or replace function product_supplier_guard() returns trigger
language plpgsql
as $$
begin
  if app_setting_text('app.seller_id') = '' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.seller_id is distinct from app_setting_uuid('app.seller_id') or new.approval_status is not null or new.sent_back_reason is not null
       or new.hidden_by is not null or new.status_before_hide is not null or new.is_sample then
      raise exception 'catalogue: a supplier creates only its own products, with no approval, hide or sample' using errcode = '42501';
    end if;
    if store_vendor_approval() or supplier_tier() = 'vendor-stock' then
      new.visibility := 'hidden';
      new.approval_status := 'pending';
    end if;
    return new;
  end if;
  if new.seller_id is distinct from old.seller_id or new.hidden_by is distinct from old.hidden_by
     or new.status_before_hide is distinct from old.status_before_hide or new.is_sample is distinct from old.is_sample then
    raise exception 'catalogue: a supplier changes no visibility, approval or hide' using errcode = '42501';
  end if;
  if new.visibility is distinct from old.visibility or new.approval_status is distinct from old.approval_status
     or new.sent_back_reason is distinct from old.sent_back_reason then
    -- Resubmitting a sent-back product works whatever the switch says, so turning approval off strands nothing.
    if not (new.approval_status = 'pending' and old.approval_status is distinct from 'pending' and new.visibility = 'hidden'
            and new.sent_back_reason is null and (store_vendor_approval() or old.approval_status = 'sent_back')) then
      raise exception 'catalogue: a supplier changes no visibility, approval or hide' using errcode = '42501';
    end if;
  end if;
  if supplier_tier() = 'vendor-stock' then
    raise exception 'catalogue: a Stock only supplier proposes products and changes none' using errcode = '42501';
  end if;
  return new;
end
$$;
