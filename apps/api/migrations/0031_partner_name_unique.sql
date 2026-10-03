-- Partners that aren't closed never share a name, ignoring case and outer spaces (FIRST-RELEASE.md
-- §4.3, #61). A clash already there stops the migration; nobody's partner is renamed for them.
do $$
declare clashes text;
begin
  select string_agg(quote_literal(key), ', ') into clashes
  from (select lower(btrim(name)) as key from partner where state <> 'closed' group by 1 having count(*) > 1) taken;
  if clashes is not null then
    raise exception 'Partners share a name: %. Rename all but one, then migrate again (#61).', clashes;
  end if;
end $$;

create unique index partner_name_unique_idx on partner (lower(btrim(name))) where state <> 'closed';
