-- Migration: which loyalty program a flight/rental's points came from
-- (e.g. "Southwest", "Hilton Honors") — free text, no fixed list. Lets the
-- stats bar and trip totals break points down by program instead of
-- summing everything into one undifferentiated number. For projects
-- created before this feature. Run once in the SQL Editor. (Fresh installs
-- don't need this — schema.sql already includes it.)

alter table public.flights
  add column points_program text;

alter table public.rentals
  add column points_program text;
