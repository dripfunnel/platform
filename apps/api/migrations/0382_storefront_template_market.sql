-- Market, the last of the starting themes #1212 removes, is gone from templates/storefront/themes (storefront
-- ARCHITECTURE §2.3), so its gallery row goes too. Stores keep the key they started from.
delete from storefront_template where key = 'market';
