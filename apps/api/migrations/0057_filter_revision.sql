-- A filter's revision (#299): its values are saved as a whole list, so a save made from an older read
-- would delete a value added since. saveFacet checks the revision it read, as collections and menus do.
alter table filter add column revision integer not null default 0;
