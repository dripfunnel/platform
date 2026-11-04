-- Five starting themes are gone from templates/storefront/themes (storefront ARCHITECTURE §2.3), so their gallery rows
-- go too; Market follows on #1218. Stores keep the key they started from.
delete from storefront_template where key in ('linen', 'concrete', 'bloom', 'circuit', 'atelier');
