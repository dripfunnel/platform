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
    and exists (select 1 from "order" o where o.id = order_id and o.state = 'cart'));
create policy request_scope on shopper_upload as restrictive for all to app_request, app_shop
  using (app_setting_text('app.scope') in ('store', 'shop') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'))
  with check (app_setting_text('app.scope') in ('store', 'shop') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'));
create policy partner_scope on shopper_upload as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on shopper_upload as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on shopper_upload as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- A shopper's removal queues its file's deletion in the same transaction, held to its own store by outbox_insert.
grant insert on outbox to app_shop;
do $$
declare
  roles text;
begin
  select string_agg(format('%I', r), ', ') into roles
  from (select unnest(p.roles::text[]) as r from pg_policies p where p.schemaname = 'public' and p.tablename = 'outbox' and p.policyname = 'outbox_insert'
        union select 'app_shop') x;
  execute format('alter policy outbox_insert on outbox to %s', roles);
end
$$;
