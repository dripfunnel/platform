-- DripFunnel's built-in sample catalog per store category (DATA-MODEL §7.2): six products in two collections, prices in
-- INR (converted at import), each photo public domain or CC0 from Openverse. Staff add it as the category's sample with
-- one click ("Add default sample"), which checks it and copies the photos once, as 0404's samples are.

create table store_category_default_sample (
  category_id uuid primary key references store_category (id),
  file text not null check (octet_length(file) <= 1048576),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$')
);
grant select on store_category_default_sample to app_platform;
alter table store_category_default_sample enable row level security;
alter table store_category_default_sample force row level security;
create policy store_category_default_sample_platform on store_category_default_sample for select to app_platform using (true);
create policy request_scope on store_category_default_sample as restrictive for all to app_request using (false) with check (false);
create policy partner_scope on store_category_default_sample as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on store_category_default_sample as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (false);
create policy system_scope on store_category_default_sample as restrictive for all to app_system using (false) with check (false);

insert into store_category_default_sample (category_id, file, currency)
select c.id, d.file, 'INR' from store_category c join (values
  ('general', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
canvas-tote-bag,Canvas Tote Bag,"Canvas Tote Bag: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-01,499.00,10,https://live.staticflickr.com/1467/23707220894_b2d9e891a2_b.jpg,Canvas Tote Bag,Everyday Essentials
ceramic-coffee-mug,Ceramic Coffee Mug,"Ceramic Coffee Mug: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-02,349.00,10,https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvdXB3azYxNzEzOTE3LXdpa2ltZWRpYS1pbWFnZS1rb3diYmJhZS5qcGc.jpg,Ceramic Coffee Mug,Everyday Essentials
stainless-water-bottle,Stainless Water Bottle,"Stainless Water Bottle: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-03,599.00,10,https://live.staticflickr.com/4246/34776192110_5dee9c8cf4_b.jpg,Stainless Water Bottle,Everyday Essentials
scented-soy-candle,Scented Soy Candle,"Scented Soy Candle: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-04,449.00,10,,,Gift Ideas
leather-notebook,Leather Notebook,"Leather Notebook: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-05,699.00,10,,,Gift Ideas
desk-plant-in-pot,Desk Plant in Pot,"Desk Plant in Pot: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,G-06,549.00,10,https://live.staticflickr.com/65535/49753915792_2f302dc5d7_b.jpg,Desk Plant in Pot,Gift Ideas
'),
  ('fashion_apparel', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
classic-cotton-t-shirt,Classic Cotton T-Shirt,"Classic Cotton T-Shirt: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-01,599.00,10,https://live.staticflickr.com/65535/51974969566_facec1a27a_b.jpg,Classic Cotton T-Shirt,Men
slim-fit-denim-jeans,Slim Fit Denim Jeans,"Slim Fit Denim Jeans: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-02,1499.00,10,,,Men
linen-casual-shirt,Linen Casual Shirt,"Linen Casual Shirt: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-03,1299.00,10,https://live.staticflickr.com/65535/55233377565_7cc4ae1bcb_b.jpg,Linen Casual Shirt,Men
floral-summer-dress,Floral Summer Dress,"Floral Summer Dress: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-04,1799.00,10,https://live.staticflickr.com/503/19300813844_5de3e8f752_b.jpg,Floral Summer Dress,Women
cotton-kurta,Cotton Kurta,"Cotton Kurta: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-05,1199.00,10,,,Women
knit-cardigan,Knit Cardigan,"Knit Cardigan: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-06,1599.00,10,https://live.staticflickr.com/65535/48994102266_c77d7621e0_b.jpg,Knit Cardigan,Women
'),
  ('footwear', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
white-canvas-sneakers,White Canvas Sneakers,"White Canvas Sneakers: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-01,1999.00,10,https://live.staticflickr.com/65535/51341837317_c77397a046_b.jpg,White Canvas Sneakers,Sneakers
running-shoes,Running Shoes,"Running Shoes: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-02,2799.00,10,https://live.staticflickr.com/7101/7181223091_76e8ea6c1e.jpg,Running Shoes,Sneakers
high-top-sneakers,High-Top Sneakers,"High-Top Sneakers: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-03,2499.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTA1L2pvYjcyNi0xODMteC5qcGc.jpg,High-Top Sneakers,Sneakers
leather-oxford-shoes,Leather Oxford Shoes,"Leather Oxford Shoes: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-04,3499.00,10,https://live.staticflickr.com/4410/36725278173_a3246c59dd_b.jpg,Leather Oxford Shoes,Formal & Sandals
brown-leather-loafers,Brown Leather Loafers,"Brown Leather Loafers: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-05,2999.00,10,https://pd.w.org/2023/02/92363e32685f2e262.95005097-2048x1365.jpg,Brown Leather Loafers,Formal & Sandals
strappy-sandals,Strappy Sandals,"Strappy Sandals: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-06,1299.00,10,https://live.staticflickr.com/65535/32741092977_b3448383fd_b.jpg,Strappy Sandals,Formal & Sandals
'),
  ('jewelry', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
pearl-pendant-necklace,Pearl Pendant Necklace,"Pearl Pendant Necklace: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-01,1899.00,10,https://live.staticflickr.com/4773/39906433175_17e4f28d6c_b.jpg,Pearl Pendant Necklace,Necklaces & Earrings
gold-hoop-earrings,Gold Hoop Earrings,"Gold Hoop Earrings: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-02,1299.00,10,,,Necklaces & Earrings
silver-chain-necklace,Silver Chain Necklace,"Silver Chain Necklace: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-03,999.00,10,https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvcHg3NzUwNDctaW1hZ2Uta3d2eGYyeGwuanBn.jpg,Silver Chain Necklace,Necklaces & Earrings
silver-band-ring,Silver Band Ring,"Silver Band Ring: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-04,799.00,10,https://live.staticflickr.com/2879/11867154404_7227c4236a_b.jpg,Silver Band Ring,Rings & Bracelets
beaded-bracelet,Beaded Bracelet,"Beaded Bracelet: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-05,499.00,10,https://live.staticflickr.com/8787/28089488113_0968f7ff26_b.jpg,Beaded Bracelet,Rings & Bracelets
gold-bangle,Gold Bangle,"Gold Bangle: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,J-06,2499.00,10,https://live.staticflickr.com/8653/27859852413_4d2c68a3a5_b.jpg,Gold Bangle,Rings & Bracelets
'),
  ('bags_luggage', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
leather-handbag,Leather Handbag,"Leather Handbag: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-01,2999.00,10,https://live.staticflickr.com/4584/37671950625_bf646002ba_b.jpg,Leather Handbag,Bags
everyday-backpack,Everyday Backpack,"Everyday Backpack: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-02,1799.00,10,https://live.staticflickr.com/65535/51484725609_4dab6cd97c_b.jpg,Everyday Backpack,Bags
crossbody-sling-bag,Crossbody Sling Bag,"Crossbody Sling Bag: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-03,1299.00,10,https://live.staticflickr.com/65535/49062061267_5ca3d06806.jpg,Crossbody Sling Bag,Bags
cabin-trolley-suitcase,Cabin Trolley Suitcase,"Cabin Trolley Suitcase: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-04,4999.00,10,https://live.staticflickr.com/3355/3567351220_81685e07c0_b.jpg,Cabin Trolley Suitcase,Travel
weekender-duffel-bag,Weekender Duffel Bag,"Weekender Duffel Bag: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-05,2499.00,10,,,Travel
travel-toiletry-pouch,Travel Toiletry Pouch,"Travel Toiletry Pouch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BL-06,599.00,10,https://live.staticflickr.com/1650/24611630239_4182b30a20_b.jpg,Travel Toiletry Pouch,Travel
'),
  ('watches', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
classic-leather-strap-watch,Classic Leather Strap Watch,"Classic Leather Strap Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-01,3499.00,10,https://live.staticflickr.com/1510/24077365622_e1b19caf2b_b.jpg,Classic Leather Strap Watch,Men’s Watches
steel-chronograph-watch,Steel Chronograph Watch,"Steel Chronograph Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-02,5999.00,10,https://live.staticflickr.com/65535/32887704057_053f0d37b1_b.jpg,Steel Chronograph Watch,Men’s Watches
digital-sports-watch,Digital Sports Watch,"Digital Sports Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-03,1999.00,10,https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvZmwyMDA3NjI1ODA1Ni1pbWFnZS1reWNqc28wMy5qcGc.jpg,Digital Sports Watch,Men’s Watches
rose-gold-mesh-watch,Rose Gold Mesh Watch,"Rose Gold Mesh Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-04,3999.00,10,https://live.staticflickr.com/1859/44381399592_3857454291_b.jpg,Rose Gold Mesh Watch,Women’s Watches
minimal-white-dial-watch,Minimal White Dial Watch,"Minimal White Dial Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-05,2999.00,10,https://live.staticflickr.com/5180/5438420888_7cf87774f9_b.jpg,Minimal White Dial Watch,Women’s Watches
vintage-pocket-watch,Vintage Pocket Watch,"Vintage Pocket Watch: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,W-06,2499.00,10,,,Women’s Watches
'),
  ('fashion_accessories', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
aviator-sunglasses,Aviator Sunglasses,"Aviator Sunglasses: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-01,1299.00,10,https://live.staticflickr.com/4658/25790124798_e9c6aede06_b.jpg,Aviator Sunglasses,Accessories
leather-belt,Leather Belt,"Leather Belt: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-02,899.00,10,,,Accessories
leather-wallet,Leather Wallet,"Leather Wallet: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-03,999.00,10,https://live.staticflickr.com/2850/9793162206_24ac744d8d.jpg,Leather Wallet,Accessories
wool-scarf,Wool Scarf,"Wool Scarf: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-04,799.00,10,https://pd.w.org/2024/04/16466138d627c9219.35963855-2048x1536.jpg,Wool Scarf,Seasonal
straw-sun-hat,Straw Sun Hat,"Straw Sun Hat: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-05,699.00,10,https://live.staticflickr.com/5220/5383419929_5ba549a233_b.jpg,Straw Sun Hat,Seasonal
knit-beanie,Knit Beanie,"Knit Beanie: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FA-06,499.00,10,https://live.staticflickr.com/65535/49081091017_01f5cbf297.jpg,Knit Beanie,Seasonal
'),
  ('beauty_personal_care', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
hydrating-face-cream,Hydrating Face Cream,"Hydrating Face Cream: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-01,699.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTA3L21pYTE3MDE2LWltYWdlLmpwZw.jpg,Hydrating Face Cream,Skincare
vitamin-c-serum,Vitamin C Serum,"Vitamin C Serum: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-02,899.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIzLTA0L2JzMjMzLWltYWdlLmpwZw.jpg,Vitamin C Serum,Skincare
clay-face-mask,Clay Face Mask,"Clay Face Mask: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-03,549.00,10,,,Skincare
herbal-shampoo,Herbal Shampoo,"Herbal Shampoo: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-04,449.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTA1L2pvYjcyOS0wMDEtdi5qcGc.jpg,Herbal Shampoo,Hair & Body
handmade-soap-bar,Handmade Soap Bar,"Handmade Soap Bar: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-05,199.00,10,https://live.staticflickr.com/65535/51385907781_e7d46fd3d2_b.jpg,Handmade Soap Bar,Hair & Body
body-lotion,Body Lotion,"Body Lotion: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BPC-06,399.00,10,https://live.staticflickr.com/35/70226254_52a76c74cd_b.jpg,Body Lotion,Hair & Body
'),
  ('perfumes_fragrances', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
woody-eau-de-parfum,Woody Eau de Parfum,"Woody Eau de Parfum: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-01,2499.00,10,,,For Him
citrus-eau-de-toilette,Citrus Eau de Toilette,"Citrus Eau de Toilette: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-02,1799.00,10,,,For Him
oud-attar,Oud Attar,"Oud Attar: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-03,1499.00,10,https://live.staticflickr.com/1783/28972727378_0a1ca12d72_b.jpg,Oud Attar,For Him
floral-eau-de-parfum,Floral Eau de Parfum,"Floral Eau de Parfum: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-04,2299.00,10,https://live.staticflickr.com/5713/20681476924_566b54c8cb_b.jpg,Floral Eau de Parfum,For Her
vanilla-body-mist,Vanilla Body Mist,"Vanilla Body Mist: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-05,899.00,10,https://live.staticflickr.com/3564/3567693590_1298a67a5b_b.jpg,Vanilla Body Mist,For Her
rose-attar,Rose Attar,"Rose Attar: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PF-06,1299.00,10,https://live.staticflickr.com/8536/8753743458_0a5a40a228_b.jpg,Rose Attar,For Her
'),
  ('health_wellness', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
yoga-mat,Yoga Mat,"Yoga Mat: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-01,1199.00,10,https://live.staticflickr.com/634/20472760469_308e71ffdb_b.jpg,Yoga Mat,Fitness & Nutrition
protein-shaker,Protein Shaker,"Protein Shaker: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-02,399.00,10,,,Fitness & Nutrition
herbal-green-tea,Herbal Green Tea,"Herbal Green Tea: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-03,349.00,10,https://live.staticflickr.com/3062/2904996976_e8d3e97cda_b.jpg,Herbal Green Tea,Fitness & Nutrition
essential-oil-set,Essential Oil Set,"Essential Oil Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-04,999.00,10,https://live.staticflickr.com/65535/50096059008_c3ed26b9a4_b.jpg,Essential Oil Set,Self Care
massage-roller,Massage Roller,"Massage Roller: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-05,599.00,10,https://pd.w.org/2026/07/3726a6048ddc674f9.02794812-1536x2048.jpg,Massage Roller,Self Care
organic-honey,Organic Honey,"Organic Honey: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HW-06,449.00,10,https://live.staticflickr.com/65535/51330849013_2fc392fd42_b.jpg,Organic Honey,Self Care
'),
  ('home_living', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
ceramic-vase,Ceramic Vase,"Ceramic Vase: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-01,899.00,10,https://live.staticflickr.com/4284/34905917253_efab1db9a4_b.jpg,Ceramic Vase,Decor
wall-mirror,Wall Mirror,"Wall Mirror: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-02,2499.00,10,,,Decor
table-lamp,Table Lamp,"Table Lamp: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-03,1799.00,10,,,Decor
cotton-cushion-cover,Cotton Cushion Cover,"Cotton Cushion Cover: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-04,449.00,10,https://live.staticflickr.com/65535/51883499092_238c7b0fb1.jpg,Cotton Cushion Cover,Textiles
woven-throw-blanket,Woven Throw Blanket,"Woven Throw Blanket: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-05,1299.00,10,https://live.staticflickr.com/6032/6422405497_228960aa6a_b.jpg,Woven Throw Blanket,Textiles
jute-rug,Jute Rug,"Jute Rug: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,HL-06,1999.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTEyL2FpYzcxNzE1LWltYWdlLmpwZw.jpg,Jute Rug,Textiles
'),
  ('furniture', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
wooden-coffee-table,Wooden Coffee Table,"Wooden Coffee Table: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-01,6999.00,10,https://pd.w.org/2025/02/58767b0267bc2e906.18851946-1536x2048.jpeg,Wooden Coffee Table,Living Room
accent-armchair,Accent Armchair,"Accent Armchair: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-02,9999.00,10,,,Living Room
bookshelf,Bookshelf,"Bookshelf: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-03,5499.00,10,https://live.staticflickr.com/646/23156651289_4f90aa7477_b.jpg,Bookshelf,Living Room
bedside-table,Bedside Table,"Bedside Table: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-04,3499.00,10,https://live.staticflickr.com/65535/50102300908_9813f83fc1_b.jpg,Bedside Table,Bedroom & Study
study-desk,Study Desk,"Study Desk: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-05,7499.00,10,https://live.staticflickr.com/962/41252892574_48e1803c73_b.jpg,Study Desk,Bedroom & Study
office-chair,Office Chair,"Office Chair: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,F-06,6499.00,10,https://live.staticflickr.com/8487/8189158766_a95ec74788_b.jpg,Office Chair,Bedroom & Study
'),
  ('kitchen_dining', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
cast-iron-skillet,Cast Iron Skillet,"Cast Iron Skillet: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-01,1499.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDIyLTA2L3Vwd2s2MTY2NjI0Ny13aWtpbWVkaWEtaW1hZ2Uta293cjd6cHAuanBn.jpg,Cast Iron Skillet,Cookware
chefs-knife,Chef’s Knife,"Chef’s Knife: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-02,1299.00,10,https://live.staticflickr.com/4113/4970062156_1bec957120_b.jpg,Chef’s Knife,Cookware
wooden-cutting-board,Wooden Cutting Board,"Wooden Cutting Board: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-03,699.00,10,https://live.staticflickr.com/580/20571996984_825fd931fc.jpg,Wooden Cutting Board,Cookware
ceramic-dinner-plates,Ceramic Dinner Plates,"Ceramic Dinner Plates: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-04,1199.00,10,https://live.staticflickr.com/7678/17137108849_c98e835d5f_b.jpg,Ceramic Dinner Plates,Tableware
glass-tumblers,Glass Tumblers,"Glass Tumblers: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-05,599.00,10,https://live.staticflickr.com/1542/24298436276_aeeb6d9ce0_b.jpg,Glass Tumblers,Tableware
copper-water-jug,Copper Water Jug,"Copper Water Jug: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,KD-06,999.00,10,https://pd.w.org/2025/02/4067a1f1364ee180.83690549-1536x2048.jpeg,Copper Water Jug,Tableware
'),
  ('garden_outdoor', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
terracotta-planter,Terracotta Planter,"Terracotta Planter: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-01,499.00,10,https://live.staticflickr.com/5611/15646693240_6588eb2a33_b.jpg,Terracotta Planter,Plants & Pots
succulent-set,Succulent Set,"Succulent Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-02,599.00,10,https://live.staticflickr.com/8644/15813630700_557083e5ae_b.jpg,Succulent Set,Plants & Pots
hanging-planter,Hanging Planter,"Hanging Planter: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-03,699.00,10,https://live.staticflickr.com/65535/49838358733_af8c79600e_b.jpg,Hanging Planter,Plants & Pots
watering-can,Watering Can,"Watering Can: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-04,799.00,10,https://live.staticflickr.com/3883/14811313052_abb16d4912_b.jpg,Watering Can,Garden Tools
garden-trowel,Garden Trowel,"Garden Trowel: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-05,349.00,10,https://pd.w.org/2026/06/2126a1d379fcd6f52.27025024-1536x2048.jpg,Garden Trowel,Garden Tools
pruning-shears,Pruning Shears,"Pruning Shears: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-06,599.00,10,https://live.staticflickr.com/8595/28824835394_94ba43026d_b.jpg,Pruning Shears,Garden Tools
'),
  ('food_grocery', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
basmati-rice,Basmati Rice,"Basmati Rice: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-01,399.00,10,https://pd.w.org/2025/11/59069274b4b4588f4.75583076-1536x2048.jpeg,Basmati Rice,Pantry
cold-pressed-olive-oil,Cold Pressed Olive Oil,"Cold Pressed Olive Oil: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-02,799.00,10,https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvZnJmb29kX29saXZlX29pbF9saXF1aWRfMC1pbWFnZS1reWJkbXZ4eC5qcGc.jpg,Cold Pressed Olive Oil,Pantry
whole-spice-box,Whole Spice Box,"Whole Spice Box: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-03,499.00,10,https://live.staticflickr.com/5083/5249996678_f1b67eb707_b.jpg,Whole Spice Box,Pantry
roasted-almonds,Roasted Almonds,"Roasted Almonds: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-04,549.00,10,https://live.staticflickr.com/1689/25448367344_2d07cfc428_b.jpg,Roasted Almonds,Snacks
dark-chocolate-bar,Dark Chocolate Bar,"Dark Chocolate Bar: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-05,249.00,10,,,Snacks
granola-mix,Granola Mix,"Granola Mix: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,FG-06,399.00,10,,,Snacks
'),
  ('beverages', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
assam-black-tea,Assam Black Tea,"Assam Black Tea: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-01,349.00,10,https://cdn.stocksnap.io/img-thumbs/960w/2WTD0XFFSD.jpg,Assam Black Tea,Tea & Coffee
arabica-coffee-beans,Arabica Coffee Beans,"Arabica Coffee Beans: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-02,699.00,10,https://live.staticflickr.com/710/22257623231_a486f15742_b.jpg,Arabica Coffee Beans,Tea & Coffee
masala-chai-mix,Masala Chai Mix,"Masala Chai Mix: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-03,299.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9zdGF0aWMvaW1hZ2Uvd2Vic2l0ZS8yMDIyLTA0L2xyL3B4Njg3OTc2LWltYWdlLWt3dnY4NHg2LmpwZw.jpg,Masala Chai Mix,Tea & Coffee
cold-pressed-orange-juice,Cold Pressed Orange Juice,"Cold Pressed Orange Juice: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-04,199.00,10,https://live.staticflickr.com/1718/26258363225_a53e7ccfb3_b.jpg,Cold Pressed Orange Juice,Juices & More
sparkling-lemonade,Sparkling Lemonade,"Sparkling Lemonade: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-05,149.00,10,https://live.staticflickr.com/1893/43522180855_b4a694a201_b.jpg,Sparkling Lemonade,Juices & More
coconut-water,Coconut Water,"Coconut Water: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,B-06,99.00,10,https://live.staticflickr.com/3585/3561073305_ccdfde1ece.jpg,Coconut Water,Juices & More
'),
  ('baby_kids', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
soft-baby-blanket,Soft Baby Blanket,"Soft Baby Blanket: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-01,899.00,10,,,Baby Care
baby-feeding-bottle,Baby Feeding Bottle,"Baby Feeding Bottle: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-02,399.00,10,https://live.staticflickr.com/65535/51330190831_c27b1e62a5_b.jpg,Baby Feeding Bottle,Baby Care
plush-teddy-bear,Plush Teddy Bear,"Plush Teddy Bear: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-03,699.00,10,https://live.staticflickr.com/647/22390342321_4dd9266938_b.jpg,Plush Teddy Bear,Baby Care
kids-cotton-t-shirt,Kids Cotton T-Shirt,"Kids Cotton T-Shirt: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-04,399.00,10,https://live.staticflickr.com/5754/23742390629_4f14d80446_b.jpg,Kids Cotton T-Shirt,Kids Clothing
kids-denim-dungaree,Kids Denim Dungaree,"Kids Denim Dungaree: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-05,999.00,10,https://live.staticflickr.com/7084/7306891404_c09e6bba49_b.jpg,Kids Denim Dungaree,Kids Clothing
kids-rain-boots,Kids Rain Boots,"Kids Rain Boots: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BK-06,799.00,10,https://live.staticflickr.com/65535/53201164890_1aebf0d5e6_b.jpg,Kids Rain Boots,Kids Clothing
'),
  ('toys_games', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
wooden-building-blocks,Wooden Building Blocks,"Wooden Building Blocks: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-01,899.00,10,https://live.staticflickr.com/3936/14971452564_edb318869f_b.jpg,Wooden Building Blocks,Toys
toy-car,Toy Car,"Toy Car: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-02,499.00,10,https://live.staticflickr.com/7007/6578390809_b906149a95_b.jpg,Toy Car,Toys
rag-doll,Rag Doll,"Rag Doll: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-03,599.00,10,https://live.staticflickr.com/4865/45987149111_bd9eb2ceff_b.jpg,Rag Doll,Toys
jigsaw-puzzle,Jigsaw Puzzle,"Jigsaw Puzzle: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-04,699.00,10,https://live.staticflickr.com/3102/2407851272_0984b87da2.jpg,Jigsaw Puzzle,Games & Puzzles
chess-set,Chess Set,"Chess Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-05,1199.00,10,https://live.staticflickr.com/2523/4163089889_f0ac0a425a_b.jpg,Chess Set,Games & Puzzles
playing-cards,Playing Cards,"Playing Cards: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TG-06,199.00,10,https://live.staticflickr.com/8650/16151357468_4b4ca16bd9_b.jpg,Playing Cards,Games & Puzzles
'),
  ('pet_supplies', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
dog-collar,Dog Collar,"Dog Collar: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-01,399.00,10,https://live.staticflickr.com/7336/11866167173_91554c330c_b.jpg,Dog Collar,Dogs
rope-chew-toy,Rope Chew Toy,"Rope Chew Toy: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-02,299.00,10,https://live.staticflickr.com/3048/3008971388_94ff350574_b.jpg,Rope Chew Toy,Dogs
dog-bed,Dog Bed,"Dog Bed: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-03,1999.00,10,https://live.staticflickr.com/4177/33738134083_ebb3a876b0_b.jpg,Dog Bed,Dogs
cat-scratching-post,Cat Scratching Post,"Cat Scratching Post: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-04,1499.00,10,https://live.staticflickr.com/8601/16327167769_3727278518_b.jpg,Cat Scratching Post,Cats
cat-food-bowl,Cat Food Bowl,"Cat Food Bowl: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-05,349.00,10,https://live.staticflickr.com/30/51580120_07f15fbd22_b.jpg,Cat Food Bowl,Cats
feather-cat-toy,Feather Cat Toy,"Feather Cat Toy: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,PS-06,249.00,10,https://live.staticflickr.com/8084/8306360172_c901db3cbb.jpg,Feather Cat Toy,Cats
'),
  ('electronics_gadgets', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
wireless-headphones,Wireless Headphones,"Wireless Headphones: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-01,3999.00,10,https://live.staticflickr.com/65535/52459692877_015fdf1c3a_b.jpg,Wireless Headphones,Audio
bluetooth-speaker,Bluetooth Speaker,"Bluetooth Speaker: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-02,2499.00,10,,,Audio
wireless-earbuds,Wireless Earbuds,"Wireless Earbuds: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-03,2999.00,10,https://live.staticflickr.com/5724/23824234216_dde666466e_b.jpg,Wireless Earbuds,Audio
power-bank,Power Bank,"Power Bank: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-04,1499.00,10,,,Accessories
mechanical-keyboard,Mechanical Keyboard,"Mechanical Keyboard: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-05,3499.00,10,https://live.staticflickr.com/65535/52399676125_3e52ca8032_b.jpg,Mechanical Keyboard,Accessories
wireless-mouse,Wireless Mouse,"Wireless Mouse: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,EG-06,899.00,10,https://live.staticflickr.com/8842/28581320904_d500e04209.jpg,Wireless Mouse,Accessories
'),
  ('cameras_photography', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
mirrorless-camera,Mirrorless Camera,"Mirrorless Camera: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-01,54999.00,10,https://live.staticflickr.com/314/19365027940_9198293e1c_b.jpg,Mirrorless Camera,Cameras
instant-film-camera,Instant Film Camera,"Instant Film Camera: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-02,6999.00,10,,,Cameras
vintage-film-camera,Vintage Film Camera,"Vintage Film Camera: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-03,8999.00,10,https://live.staticflickr.com/2445/4044029012_50e7e0f9ff_b.jpg,Vintage Film Camera,Cameras
camera-tripod,Camera Tripod,"Camera Tripod: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-04,2499.00,10,https://live.staticflickr.com/1862/29758566567_84788485c6_b.jpg,Camera Tripod,Gear
prime-lens-50mm,Prime Lens 50mm,"Prime Lens 50mm: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-05,14999.00,10,https://live.staticflickr.com/8049/29030649476_605606c1b9_b.jpg,Prime Lens 50mm,Gear
camera-bag,Camera Bag,"Camera Bag: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CP-06,2999.00,10,https://live.staticflickr.com/1861/44488692402_a2511e4bdd_b.jpg,Camera Bag,Gear
'),
  ('sports_fitness', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
pair-of-dumbbells,Pair of Dumbbells,"Pair of Dumbbells: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-01,1999.00,10,https://live.staticflickr.com/65535/51960984380_f3fa7e68e1_b.jpg,Pair of Dumbbells,Training
skipping-rope,Skipping Rope,"Skipping Rope: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-02,299.00,10,https://live.staticflickr.com/7240/27477704496_cbdfeb77eb_b.jpg,Skipping Rope,Training
resistance-bands,Resistance Bands,"Resistance Bands: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-03,599.00,10,https://live.staticflickr.com/5805/23898625111_6305e291e2_b.jpg,Resistance Bands,Training
cricket-bat,Cricket Bat,"Cricket Bat: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-04,2499.00,10,https://live.staticflickr.com/709/21524047600_dcbee76e2d_b.jpg,Cricket Bat,Outdoor Sports
football,Football,"Football: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-05,899.00,10,,,Outdoor Sports
badminton-racket,Badminton Racket,"Badminton Racket: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,SF-06,1299.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9zdGF0aWMvaW1hZ2Uvd2Vic2l0ZS8yMDIyLTA0L2xyL3N2MTI2MTMzLWltYWdlLWt3dnVpeHJwLmpwZw.jpg,Badminton Racket,Outdoor Sports
'),
  ('automotive', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
microfiber-cleaning-cloths,Microfiber Cleaning Cloths,"Microfiber Cleaning Cloths: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-01,399.00,10,https://live.staticflickr.com/65535/52625831843_108e5fd04e_b.jpg,Microfiber Cleaning Cloths,Car Care
car-wash-shampoo,Car Wash Shampoo,"Car Wash Shampoo: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-02,499.00,10,https://live.staticflickr.com/60/197660066_58d3f5b813.jpg,Car Wash Shampoo,Car Care
tyre-inflator,Tyre Inflator,"Tyre Inflator: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-03,2499.00,10,https://live.staticflickr.com/65535/51321968557_ae0ce753d0_b.jpg,Tyre Inflator,Car Care
car-phone-mount,Car Phone Mount,"Car Phone Mount: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-04,599.00,10,https://live.staticflickr.com/65535/49062686647_0f2dbd25fd.jpg,Car Phone Mount,Accessories
seat-cushion,Seat Cushion,"Seat Cushion: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-05,999.00,10,https://live.staticflickr.com/7323/27847410202_96511eb2b7_b.jpg,Seat Cushion,Accessories
dashboard-camera,Dashboard Camera,"Dashboard Camera: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,A-06,3999.00,10,,,Accessories
'),
  ('books_stationery', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
classic-novel,Classic Novel,"Classic Novel: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-01,399.00,10,https://live.staticflickr.com/8083/8407918008_3d144f0ca1_b.jpg,Classic Novel,Books
illustrated-cookbook,Illustrated Cookbook,"Illustrated Cookbook: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-02,799.00,10,https://live.staticflickr.com/65535/49554717307_8552bd611d.jpg,Illustrated Cookbook,Books
poetry-collection,Poetry Collection,"Poetry Collection: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-03,349.00,10,https://live.staticflickr.com/65535/49986875456_98d5f4452b_b.jpg,Poetry Collection,Books
dotted-journal,Dotted Journal,"Dotted Journal: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-04,499.00,10,https://live.staticflickr.com/323/18692171181_1c629359e2_b.jpg,Dotted Journal,Stationery
fountain-pen,Fountain Pen,"Fountain Pen: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-05,899.00,10,https://live.staticflickr.com/65535/48955757323_4c4932c298_b.jpg,Fountain Pen,Stationery
coloured-pencil-set,Coloured Pencil Set,"Coloured Pencil Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BS-06,449.00,10,https://live.staticflickr.com/65535/49396200342_1667d398c6_b.jpg,Coloured Pencil Set,Stationery
'),
  ('arts_crafts_diy', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
watercolour-paint-set,Watercolour Paint Set,"Watercolour Paint Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-01,999.00,10,https://live.staticflickr.com/2806/10090395715_822167a1d9_b.jpg,Watercolour Paint Set,Art Supplies
acrylic-paint-brushes,Acrylic Paint Brushes,"Acrylic Paint Brushes: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-02,499.00,10,https://live.staticflickr.com/4508/37606472696_d3fc6700d1_b.jpg,Acrylic Paint Brushes,Art Supplies
canvas-panels,Canvas Panels,"Canvas Panels: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-03,599.00,10,https://live.staticflickr.com/65535/49602421522_d324f8274c_b.jpg,Canvas Panels,Art Supplies
knitting-starter-kit,Knitting Starter Kit,"Knitting Starter Kit: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-04,899.00,10,,,Craft Kits
embroidery-kit,Embroidery Kit,"Embroidery Kit: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-05,699.00,10,https://live.staticflickr.com/65535/49060847191_9c1a62b91d.jpg,Embroidery Kit,Craft Kits
pottery-clay,Pottery Clay,"Pottery Clay: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,ACD-06,549.00,10,https://live.staticflickr.com/8150/27857224813_da0000d254_b.jpg,Pottery Clay,Craft Kits
'),
  ('gifts_occasions', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
festive-gift-hamper,Festive Gift Hamper,"Festive Gift Hamper: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-01,1999.00,10,,,Gift Hampers
chocolate-gift-box,Chocolate Gift Box,"Chocolate Gift Box: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-02,899.00,10,https://live.staticflickr.com/8343/8279524697_0ee74648f3_b.jpg,Chocolate Gift Box,Gift Hampers
personalised-photo-frame,Personalised Photo Frame,"Personalised Photo Frame: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-03,699.00,10,https://live.staticflickr.com/635/32872074656_3d200d6585_b.jpg,Personalised Photo Frame,Gift Hampers
party-balloon-set,Party Balloon Set,"Party Balloon Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-04,299.00,10,https://live.staticflickr.com/7131/7523727438_08eac9181b_b.jpg,Party Balloon Set,Party & Celebration
greeting-card-pack,Greeting Card Pack,"Greeting Card Pack: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-05,249.00,10,https://live.staticflickr.com/1546/23631551533_145cc9b7cf_b.jpg,Greeting Card Pack,Party & Celebration
decorative-diyas,Decorative Diyas,"Decorative Diyas: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,GO-06,399.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9sci9pbWFnZXMvd2Vic2l0ZS8yMDI0LTAyL2xyL3djdmFuNGhqbnUtaW1hZ2UuanBn.jpg,Decorative Diyas,Party & Celebration
'),
  ('collectibles_hobbies', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
vintage-coin-set,Vintage Coin Set,"Vintage Coin Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-01,2499.00,10,https://live.staticflickr.com/8108/29233770050_5657cb3c1a_b.jpg,Vintage Coin Set,Collectibles
postage-stamp-album,Postage Stamp Album,"Postage Stamp Album: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-02,999.00,10,,,Collectibles
die-cast-model-car,Die-Cast Model Car,"Die-Cast Model Car: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-03,1499.00,10,https://live.staticflickr.com/5350/31311605986_2567ded56f_b.jpg,Die-Cast Model Car,Collectibles
model-train-set,Model Train Set,"Model Train Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-04,4999.00,10,https://live.staticflickr.com/864/41758969611_7496024683_b.jpg,Model Train Set,Hobbies
telescope,Telescope,"Telescope: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-05,6999.00,10,https://live.staticflickr.com/104/300043984_ca2cd16191_b.jpg,Telescope,Hobbies
acoustic-ukulele,Acoustic Ukulele,"Acoustic Ukulele: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,CH-06,2999.00,10,https://live.staticflickr.com/5335/31215646962_c3bd19de64_b.jpg,Acoustic Ukulele,Hobbies
'),
  ('tools_hardware', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
claw-hammer,Claw Hammer,"Claw Hammer: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-01,599.00,10,https://live.staticflickr.com/65535/53880090420_f00c09221c_b.jpg,Claw Hammer,Hand Tools
screwdriver-set,Screwdriver Set,"Screwdriver Set: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-02,799.00,10,https://live.staticflickr.com/8769/17072579685_7d43d0ceb4_b.jpg,Screwdriver Set,Hand Tools
adjustable-wrench,Adjustable Wrench,"Adjustable Wrench: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-03,499.00,10,https://live.staticflickr.com/1131/1400033038_06c8252e22_b.jpg,Adjustable Wrench,Hand Tools
cordless-drill,Cordless Drill,"Cordless Drill: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-04,4999.00,10,,,Power Tools
tape-measure,Tape Measure,"Tape Measure: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-05,349.00,10,https://live.staticflickr.com/3760/11148107915_468715cb29_b.jpg,Tape Measure,Power Tools
tool-box,Tool Box,"Tool Box: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,TH-06,1499.00,10,https://live.staticflickr.com/101/265764063_fa92e28d1c_b.jpg,Tool Box,Power Tools
'),
  ('business_industrial', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
printer-paper-ream,Printer Paper Ream,"Printer Paper Ream: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-01,399.00,10,https://live.staticflickr.com/7067/6782923350_435083148a_b.jpg,Printer Paper Ream,Office Supplies
desk-organiser,Desk Organiser,"Desk Organiser: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-02,799.00,10,https://live.staticflickr.com/1306/899179066_a99a2d3c83_b.jpg,Desk Organiser,Office Supplies
label-printer,Label Printer,"Label Printer: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-03,3499.00,10,https://live.staticflickr.com/4774/38919293000_f2062ee680_b.jpg,Label Printer,Office Supplies
safety-helmet,Safety Helmet,"Safety Helmet: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-04,599.00,10,https://live.staticflickr.com/7825/33716178768_21eec918c8_b.jpg,Safety Helmet,Safety & Storage
work-gloves,Work Gloves,"Work Gloves: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-05,299.00,10,https://live.staticflickr.com/65535/51910929853_68abfd7c92.jpg,Work Gloves,Safety & Storage
storage-crate,Storage Crate,"Storage Crate: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,BI-06,699.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9zdGF0aWMvaW1hZ2Uvd2Vic2l0ZS8yMDIyLTA0L2xyL2ZyY3JhdGVzX3BsYXN0aWNfYmx1ZV95ZWxsb3ctaW1hZ2Uta3liZHZoZDAuanBn.jpg,Storage Crate,Safety & Storage
'),
  ('religious_spiritual', 'handle,name,description,visible,sku,price,stock,image,image alt,collection
brass-diya,Brass Diya,"Brass Diya: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-01,499.00,10,,,Pooja Essentials
incense-sticks,Incense Sticks,"Incense Sticks: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-02,149.00,10,https://live.staticflickr.com/1904/45565289981_ec6e4577f6_b.jpg,Incense Sticks,Pooja Essentials
brass-pooja-thali,Brass Pooja Thali,"Brass Pooja Thali: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-03,999.00,10,,,Pooja Essentials
rudraksha-mala,Rudraksha Mala,"Rudraksha Mala: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-04,699.00,10,,,Meditation
meditation-cushion,Meditation Cushion,"Meditation Cushion: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-05,1299.00,10,,,Meditation
singing-bowl,Singing Bowl,"Singing Bowl: a sample product to show how your shop looks. Change its photo, price and details, or remove it.",yes,RS-06,1999.00,10,https://images.rawpixel.com/editor_1024/cHJpdmF0ZS9zdGF0aWMvaW1hZ2Uvd2Vic2l0ZS8yMDIyLTA0L2xyL2ZyYm93bHNfa2xhbmtzY2hhYWxfa25vY2tlcl9zb3VuZC1pbWFnZS1reWJjMHYxZy5qcGc.jpg,Singing Bowl,Meditation
')
) as d (key, file) on d.key = c.key;
