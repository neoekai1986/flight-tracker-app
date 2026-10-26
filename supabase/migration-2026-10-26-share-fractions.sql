-- Migration: remember a percentage share as it was typed.
-- Run once in the SQL Editor. Safe to run more than once.

-- A share of "1/6" is stored as 16.666666666666668 percent, which is the
-- right number and the wrong thing to show someone. This keeps what was
-- actually typed, for display only — cost_percent stays the one figure the
-- arithmetic reads, so there is still exactly one source of truth and this
-- can't drift into a second one.
alter table public.booking_people
  add column if not exists cost_percent_text text;
