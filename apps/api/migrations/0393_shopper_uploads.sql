-- A file a shopper uploads as an answer (#1369; DATA-MODEL §7.6, §7.11; PLATFORM-PROMPT §5.4): tied to the cart it was
-- sent with, whose id stays the order's. Kept with no automatic deletion (rule 30 of #1367); the shopper erases their own
-- through the cart, under the delete branch below, and the R2 object goes through the outbox (`upload.delete`).

create table shopper_upload (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  order_id uuid not null,
  question_id uuid references product_question (id) on delete set null,
  r2_key text not null unique check (r2_key ~ '^stores/[0-9a-f-]{36}/shopper-uploads/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  bytes integer not null check (bytes between 1 and 10485760),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id) on delete restrict
);
create index shopper_upload_order_idx on shopper_upload (store_id, order_id);

-- r2_key is selected by no request role: a file opens only through the engine's signed link.
grant select, insert, update, delete on shopper_upload to app_system;
grant select (id, store_id, order_id, question_id, mime, bytes, checksum, created_at) on shopper_upload to app_request, app_shop;
grant insert (id, store_id, order_id, question_id, r2_key, mime, bytes, checksum) on shopper_upload to app_shop;
grant delete on shopper_upload to app_shop;

alter table shopper_upload enable row level security;
alter table shopper_upload force row level security;
create policy shopper_upload_system on shopper_upload for all to app_system using (true) with check (true);
-- The merchant side reads its store's; a supplier holds no grant (its link is minted in system scope, §7.11).
create policy shopper_upload_merchant on shopper_upload for select to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
-- A shopper's own cart only: the subquery runs under "order"'s own shop policy (its account, or the guest's token).
create policy shopper_upload_shop on shopper_upload for all to app_shop
  using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
    and exists (select 1 from "order" o where o.id = order_id and o.state = 'cart'))
  with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
    and exists (select 1 from "order" o where o.id = order_id and o.state = 'cart')
    -- The question too is read under its own shop policy: a visible product's, of this store.
    and exists (select 1 from product_question q where q.id = question_id and q.store_id = shopper_upload.store_id));
create policy request_scope on shopper_upload as restrictive for all to app_request, app_shop
  using (app_setting_text('app.scope') in ('store', 'shop') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'))
  with check (app_setting_text('app.scope') in ('store', 'shop') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'));
create policy partner_scope on shopper_upload as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on shopper_upload as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on shopper_upload as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- A deleted row queues its own file's deletion in the same transaction, the key taken from the row, never from a caller:
-- the shop role holds no outbox grant.
create function shopper_upload_deleted() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into outbox (kind, idempotency_key, payload, partner_id, store_id)
  select 'upload.delete', 'upload.delete:' || s.partner_id || ':' || old.store_id || ':' || old.id, jsonb_build_object('key', old.r2_key), s.partner_id, old.store_id
  from store s where s.id = old.store_id
  on conflict (idempotency_key) do nothing;
  return null;
end
$$;
alter function shopper_upload_deleted() owner to app_definer;
create trigger shopper_upload_deleted after delete on shopper_upload for each row execute function shopper_upload_deleted();
