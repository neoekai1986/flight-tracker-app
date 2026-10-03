-- Migration: which airline a flight is on.
-- Run once in the SQL Editor. Safe to run more than once.
--
-- No RLS changes: it's a column on flights, so it inherits that table's
-- existing policies.
--
-- A search URL carries the route and dates but never the airline — that
-- only exists in the search results — so this is typed in alongside the
-- price when you pick a flight to track.

alter table public.flights
  add column if not exists airline text;
