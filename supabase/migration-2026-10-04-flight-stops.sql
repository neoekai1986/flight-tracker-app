-- Migration: stops per leg on a flight.
-- Run once in the SQL Editor. Safe to run more than once.
--
-- No RLS changes: columns on flights, so they inherit that table's policies.
--
-- Two columns rather than one, because the legs of a round trip routinely
-- differ — out nonstop, back via somewhere. Free text ("nonstop",
-- "1 stop (ATL)") since it's read, not calculated with.

alter table public.flights
  add column if not exists stops_out  text,
  add column if not exists stops_back text;
