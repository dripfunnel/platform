-- Home's checklist adds "Add your logo and favicon" (FIRST-RELEASE §5): optional, so the Owner may skip it as payments and
-- shipping (0351). Widens the check only; set_setup_step_skipped() already writes any step the check allows.
alter table store drop constraint store_setup_skipped_check;
alter table store add constraint store_setup_skipped_check check (setup_skipped <@ array['payments', 'shipping', 'brand']);
