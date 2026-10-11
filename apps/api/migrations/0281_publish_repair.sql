-- INF 4 (#483), part 5: the publish gate's repair, bisect and refuse (storefront ARCHITECTURE §4.2 step 4, LIVE-SHOP §4; DATA-MODEL
-- §7.8). Nothing here is destructive: new nullable or defaulted columns, one new state, and the running index narrowed.

alter table publish_run
  -- A repair's or a bisect's build belongs to the publish it serves; the publish's own first build has neither.
  add column attempt_of uuid references publish_run (id),
  add column attempt text check (attempt in ('repair', 'bisect')),
  add column repair_attempts integer not null default 0 check (repair_attempts between 0 and 3),
  -- The draft's first change whose build failed the gate, which "publish everything before this change" stops short of.
  add column bisect_commit text check (bisect_commit ~ '^[0-9a-f]{40}$'),
  add constraint publish_run_attempt_whole check ((attempt is null) = (attempt_of is null));

-- 'checked': a bisect's build that passed the gate and was never meant to go live.
alter table publish_run drop constraint publish_run_state_check,
  add constraint publish_run_state_check check (state in ('queued', 'building', 'checking', 'checked', 'deploying', 'live', 'failed', 'rolled_back'));

-- One publish at a time per store, as before; its repair and bisect builds run one at a time beside it.
drop index publish_run_one_running;
create unique index publish_run_one_running on publish_run (store_id) where state in ('building', 'checking', 'deploying') and attempt_of is null;
create unique index publish_run_one_attempt on publish_run (attempt_of) where state in ('building', 'checking', 'deploying') and attempt_of is not null;

-- The draft's accepted changes since the live version, oldest first, which a failing design publish bisects (§4.2 step 4).
alter table design_draft add column commits text[] not null default '{}' check (array_position(commits, null) is null);
