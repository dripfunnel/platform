-- Only the Classic and "Start from scratch" starting themes remain (storefront ARCHITECTURE §2.3); the other six are
-- gone from templates/storefront/themes, so their gallery rows go too. Stores keep the key they started from.
delete from storefront_template where key in ('linen', 'concrete', 'bloom', 'circuit', 'market', 'atelier');
