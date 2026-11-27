-- #1743: every partner bills its own merchants; DripFunnel charges partners by hand (SAAS §7.1). 'dripfunnel' stays
-- allowed so the previous release keeps running.
update partner set billing_mode = 'own' where billing_mode <> 'own';
alter table partner alter column billing_mode set default 'own';
