-- Migration: arrival times and durations, so a flight card can read like the
-- search result it came from.
-- Run once in the SQL Editor. Safe to run more than once.

-- The paste parser has always found these: it matches departure–arrival
-- pairs and kept only the departure. Storing the other half costs nothing to
-- collect and is what turns "7:15 AM" into "7:15 AM – 10:09 AM".
alter table public.flights
  add column if not exists arrive_time        time,
  add column if not exists return_arrive_time time;

-- Duration as text, because it can't be worked out from the two times: a
-- flight that leaves IAD at 7:15 and lands at SLC at 10:09 takes 4h 54m, not
-- 2h 54m, and nothing here knows about time zones. The search result states
-- it outright, so it's taken from there rather than computed wrongly.
alter table public.flights
  add column if not exists duration_out  text,
  add column if not exists duration_back text;
