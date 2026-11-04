-- The gallery offers only Classic (storefront ARCHITECTURE §2.3). Market, the last of the starting themes #1212 removes,
-- is gone from templates/storefront/themes, so its row goes too; Start from scratch is retired, its theme kept for §7.
delete from storefront_template where key = 'market';
update storefront_template set state = 'retired' where key = 'baseline';
