-- What a store sells (DATA-MODEL §7.2): a platform-wide list DripFunnel staff keep in the Admin console, picked once by
-- the store's Owner on Home's checklist or Settings › Catalogue. Nothing here is destructive: one new table, seeded,
-- and one nullable store column.

create table store_category (
  id uuid primary key default gen_random_uuid(),
  -- Stable for code and prompts; a name can change, the key never does.
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- {language: name}, English required, others falling back to it.
  names jsonb not null check (jsonb_typeof(names) = 'object' and coalesce(char_length(names ->> 'en'), 0) between 1 and 60),
  -- The product page sections shops of this kind usually use, offered to the Owner, never forced (CATALOG P1).
  sections text[] not null default '{}'
    check (sections <@ array['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video']),
  position integer not null,
  -- Archived: gone from the picker; a store that chose it keeps it.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_category_position_idx on store_category (position, id);

grant select on store_category to app_request, app_partner, app_system, app_definer;
grant select, insert, update on store_category to app_platform;
alter table store_category enable row level security;
alter table store_category force row level security;
create policy store_category_read on store_category for select to app_request, app_partner, app_system, app_definer using (true);
create policy store_category_platform on store_category for all to app_platform using (true) with check (true);
create policy request_scope on store_category as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (false);
create policy partner_scope on store_category as restrictive for all to app_partner
using (app_setting_text('app.scope') = 'partner') with check (false);
create policy platform_scope on store_category as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on store_category as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (false);

insert into store_category (key, names, sections, position) values
  ('general', '{"en": "General"}', '{specs,highlights}', 1),
  ('fashion_apparel', '{"en": "Fashion & Apparel"}', '{sizeCharts,specs,highlights,badges}', 2),
  ('footwear', '{"en": "Footwear"}', '{sizeCharts,specs,highlights,badges}', 3),
  ('jewelry', '{"en": "Jewelry"}', '{specs,highlights,badges}', 4),
  ('bags_luggage', '{"en": "Bags & Luggage"}', '{specs,highlights,badges}', 5),
  ('watches', '{"en": "Watches"}', '{specs,highlights,faqs}', 6),
  ('fashion_accessories', '{"en": "Fashion Accessories"}', '{sizeCharts,specs,highlights,badges}', 7),
  ('beauty_personal_care', '{"en": "Beauty & Personal Care"}', '{highlights,faqs}', 8),
  ('perfumes_fragrances', '{"en": "Perfumes & Fragrances"}', '{highlights,faqs}', 9),
  ('health_wellness', '{"en": "Health & Wellness"}', '{specs,highlights,faqs}', 10),
  ('home_living', '{"en": "Home & Living"}', '{specs,highlights,related}', 11),
  ('furniture', '{"en": "Furniture"}', '{specs,highlights,faqs,related}', 12),
  ('kitchen_dining', '{"en": "Kitchen & Dining"}', '{specs,highlights,related}', 13),
  ('garden_outdoor', '{"en": "Garden & Outdoor"}', '{specs,highlights,faqs}', 14),
  ('food_grocery', '{"en": "Food & Grocery"}', '{specs,highlights,faqs}', 15),
  ('beverages', '{"en": "Beverages"}', '{specs,highlights,faqs}', 16),
  ('baby_kids', '{"en": "Baby & Kids"}', '{sizeCharts,specs,highlights,faqs}', 17),
  ('toys_games', '{"en": "Toys & Games"}', '{specs,highlights,faqs}', 18),
  ('pet_supplies', '{"en": "Pet Supplies"}', '{specs,highlights,faqs}', 19),
  ('electronics_gadgets', '{"en": "Electronics & Gadgets"}', '{specs,highlights,faqs,related}', 20),
  ('cameras_photography', '{"en": "Cameras & Photography"}', '{specs,highlights,faqs,related}', 21),
  ('sports_fitness', '{"en": "Sports & Fitness"}', '{sizeCharts,specs,highlights}', 22),
  ('automotive', '{"en": "Automotive"}', '{specs,faqs,related}', 23),
  ('books_stationery', '{"en": "Books & Stationery"}', '{specs,highlights}', 24),
  ('arts_crafts_diy', '{"en": "Arts, Crafts & DIY"}', '{highlights,badges}', 25),
  ('gifts_occasions', '{"en": "Gifts & Occasions"}', '{highlights,badges,related}', 26),
  ('collectibles_hobbies', '{"en": "Collectibles & Hobbies"}', '{specs,highlights,badges}', 27),
  ('tools_hardware', '{"en": "Tools & Hardware"}', '{specs,faqs,related}', 28),
  ('business_industrial', '{"en": "Business & Industrial"}', '{specs,faqs}', 29),
  ('religious_spiritual', '{"en": "Religious & Spiritual"}', '{highlights,faqs}', 30);

alter table store add column category_id uuid references store_category (id);
-- The Partner and Admin store lists filter on it.
create index store_category_id_idx on store (category_id) where category_id is not null;

-- The merchant side of a store picks it, as set_setup_step_skipped (0351) writes setup_skipped: never a supplier or a
-- read-only support session. An archived category can't be newly chosen.
create function set_store_category(category uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'set_store_category: the merchant side of a store only' using errcode = '42501';
  end if;
  if not exists (select 1 from store_category where id = category and archived_at is null) then
    raise exception 'set_store_category: no such category' using errcode = 'P0002';
  end if;
  update store set category_id = category where id = app_setting_uuid('app.store_id');
end
$$;
grant select (id, category_id) on store to app_definer;
grant update (category_id) on store to app_definer;
alter function set_store_category(uuid) owner to app_definer;
revoke execute on function set_store_category(uuid) from public;
grant execute on function set_store_category(uuid) to app_request;
