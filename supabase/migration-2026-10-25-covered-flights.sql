-- Migration: one person covering another's share of a booking.
-- Run once in the SQL Editor. Safe to run more than once.

-- "Covered" is not the same as "free". The ticket still costs what it costs;
-- it just isn't theirs to pay. So the share is worked out exactly as it would
-- have been and charged to whoever is covering it, rather than being set to
-- zero and quietly shrinking the booking.
alter table public.booking_people
  add column if not exists is_covered boolean not null default false;

-- Who is covering it. Null with is_covered set means whoever paid the
-- booking, which is the usual case and saves picking the same name every
-- time. A separate column rather than a sentinel in is_covered because
-- "covered by the payer" and "covered by Eugene" are both real answers.
alter table public.booking_people
  add column if not exists covered_by uuid references public.people(id) on delete set null;
