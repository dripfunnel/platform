-- Category templates (#1537, storefront ARCHITECTURE §2.3): a starting theme per store category, so a new store skips the
-- gallery (DATA-MODEL §7.2). Adds rows and one nullable column; nothing destructive. Re-runnable: it was 0408 on early local databases.
insert into storefront_template (key, name, tag, description, core_min_version) values
  ('fashion', 'Thread', 'Fashion & apparel', 'Clean editorial layout with big portrait photos, a lookbook hero and new arrivals up front.', '0.14.0'),
  ('jewelry', 'Aurum', 'Jewellery', 'Warm ivory, gold accents and elegant serif type. A still, centred hero and arched collection tiles.', '0.14.0'),
  ('beauty', 'Glow', 'Beauty & personal care', 'Soft blush colours, rounded shapes and friendly type. A split hero, a daily routine and favourites.', '0.14.0'),
  ('grocery', 'Basket', 'Food & grocery', 'Bright, friendly and quick to browse. Categories first, big search, compact grids and clear prices.', '0.14.0'),
  ('home', 'Nest', 'Home & living', 'Earthy tones, generous photos and a warm serif. A full-width hero, rooms to shop and a photo collage.', '0.14.0'),
  ('electronics', 'Volt', 'Electronics & gadgets', 'Crisp and modern on a dark stage. Square category cards, a product spotlight and clear prices.', '0.14.0')
on conflict (key) do update set name = excluded.name, tag = excluded.tag, description = excluded.description;

alter table store_category add column if not exists template_key text references storefront_template (key);

update store_category c set template_key = m.template_key
from (values ('fashion_apparel', 'fashion'), ('jewelry', 'jewelry'), ('beauty_personal_care', 'beauty'), ('food_grocery', 'grocery'), ('home_living', 'home'), ('electronics_gadgets', 'electronics')) as m (category_key, template_key)
where c.key = m.category_key;
