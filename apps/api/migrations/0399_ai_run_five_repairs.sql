-- A studio change is repaired up to five times since 2026-11-12 (storefront ARCHITECTURE §6.2), so its run records up to five.
-- The check only widens: every row today passes it, and the previous build never writes past three.
alter table ai_run drop constraint ai_run_repair_attempts_check;
alter table ai_run add constraint ai_run_repair_attempts_check check (repair_attempts between 0 and 5);
