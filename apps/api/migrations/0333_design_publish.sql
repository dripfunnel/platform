-- SAPI 17 (#318), part 3: going back across a security release rebuilds the version on the fixed core (SAAS §9.2), from
-- the version's own kept source, not the live build's (LIVE-SHOP §4 step 3).
alter table publish_run add column source_build_id uuid references publish_run (id);
