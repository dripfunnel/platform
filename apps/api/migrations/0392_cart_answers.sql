-- Answers on a cart line and their snapshot on an order line (#1368; DATA-MODEL §7.6, §7.11; PLATFORM-PROMPT §5.4).
-- A line without answers keeps today's key (answers_key ''), so every existing line and every product without questions
-- is untouched.

alter table cart_line
  add column id uuid not null default gen_random_uuid(),
  add column answers jsonb check (answers is null or (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) between 1 and 10)),
  add column answers_key text not null default '';
alter table cart_line add constraint cart_line_id_key unique (id);
-- Expand: the new key beside the old one, which the next release drops (contract; DATA-MODEL §7.6).
create unique index cart_line_line_key on cart_line (order_id, version_id, answers_key);

-- Equal answers are one line (fact 56): the key is the answers' own hash, never the caller's to set. The engine writes the
-- answers already ordered (question, then choice), and jsonb's text form is canonical, so equal answers hash equal.
create function cart_line_answers_key() returns trigger
language plpgsql
as $$
begin
  new.answers_key := case when new.answers is null then '' else encode(sha256(convert_to(new.answers::text, 'UTF8')), 'hex') end;
  return new;
end
$$;
create trigger cart_line_answers_key before insert or update on cart_line for each row execute function cart_line_answers_key();

-- The immutable snapshot of a customised line at placement, null on any other; the extras inside its unit and line totals.
alter table order_line
  add column answers jsonb,
  add column unit_extras_amount bigint not null default 0 check (unit_extras_amount >= 0),
  add column line_extras_amount bigint not null default 0 check (line_extras_amount >= 0);
grant select (answers, unit_extras_amount, line_extras_amount) on order_line to app_shop;

-- A supplier reads its own lines' answers and money through its view only, never order_line's money columns (§7.11).
grant select (answers, line_extras_amount) on order_line to app_definer;
create or replace view order_line_for_supplier with (security_barrier) as
  select l.id, l.order_id, l.store_id, l.seller_id, l.quantity, l.unit_amount, l.unit_amount * l.quantity + l.line_extras_amount as line_amount, o.currency, l.answers
  from order_line l join "order" o on o.id = l.order_id and o.store_id = l.store_id
  where app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') <> ''
    and l.store_id = app_setting_uuid('app.store_id') and l.seller_id = app_setting_uuid('app.seller_id') and o.state <> 'cart'
    and (o.payment_state <> 'pending' or o.payment_method in ('cod', 'bank_transfer'))
    and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test');
