-- A supplier shows and hides its own approved product (#1717). Approval, a sent-back reason and every hide
-- (plan, suspension, removal) stay the merchant's: ACCESS.md §7.2, DATA-MODEL.md §4.2.

create or replace function product_supplier_guard() returns trigger
language plpgsql
as $$
declare
  visibility_only boolean;
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
  visibility_only := new.approval_status is not distinct from old.approval_status
    and new.sent_back_reason is not distinct from old.sent_back_reason
    and old.hidden_by is null
    and coalesce(old.approval_status, 'approved') = 'approved';
  if new.approval_status is distinct from old.approval_status or new.sent_back_reason is distinct from old.sent_back_reason
     or (new.visibility is distinct from old.visibility and not visibility_only) then
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
