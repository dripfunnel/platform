-- A merchant's own name for a file in Storefront › Assets (docs/storefront/AI-STUDIO.md §8). Additive and nullable, so the
-- previous release reads and writes `asset` as before; an unnamed file shows its type and size.
alter table asset add column if not exists name text check (char_length(name) between 1 and 120);
grant update (name) on asset to app_request;
