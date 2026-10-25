-- Migration: mark a seat as flown on a companion pass.
-- Run once in the SQL Editor. Safe to run more than once.

-- A companion seat costs its passenger nothing, but "0" in the share box
-- doesn't say why — it reads the same as a share someone forgot to fill in,
-- and the next person to look at the booking can't tell the difference. This
-- records the reason, so the summary can say "companion pass" rather than
-- "$0.00" and the figure stops looking like an omission.
--
-- No RLS changes: it's a column on booking_people, which already has
-- policies covering it.
alter table public.booking_people
  add column if not exists is_companion boolean not null default false;
