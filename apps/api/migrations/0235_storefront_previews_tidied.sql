-- INF 2 (#317), part 2 review: which publish a store's preview folders were last tidied against (storefront PREVIEW.md §3),
-- so the daily clean-up takes each store once per publish, oldest first. A new, empty column.
alter table storefront add column previews_tidied_at timestamptz;
