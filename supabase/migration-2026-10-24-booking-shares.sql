-- Migration: explicit payers, group shares on housing, percentage shares,
-- and a points-to-cash rate so award flights can be charged on.
-- Run once in the SQL Editor. Safe to run more than once.

-- Payers and shares now point at the master people list rather than at a
-- trip_people row. The roster stays "who's on this trip"; it is no longer a
-- prerequisite for recording that someone paid. In particular it means you
-- are always selectable without having to add yourself to a roster first.
alter table public.flights drop constraint if exists flights_paid_by_fkey;
alter table public.rentals drop constraint if exists rentals_paid_by_fkey;
alter table public.booking_people drop constraint if exists booking_people_person_id_fkey;

update public.flights f set paid_by = tp.person_id
  from public.trip_people tp where f.paid_by = tp.id;
update public.rentals r set paid_by = tp.person_id
  from public.trip_people tp where r.paid_by = tp.id;
update public.booking_people bp set person_id = tp.person_id
  from public.trip_people tp where bp.person_id = tp.id;

alter table public.flights
  add constraint flights_paid_by_fkey foreign key (paid_by)
  references public.people(id) on delete set null;
alter table public.rentals
  add constraint rentals_paid_by_fkey foreign key (paid_by)
  references public.people(id) on delete set null;

-- A share can belong to a household instead of a person — housing is booked
-- for a family, not for four individuals who happen to be related.
alter table public.booking_people
  add column if not exists group_id uuid references public.person_groups(id) on delete cascade;

alter table public.booking_people alter column person_id drop not null;

alter table public.booking_people
  add constraint booking_people_one_subject
  check ( (person_id is not null)::int + (group_id is not null)::int = 1 ) not valid;

alter table public.booking_people
  add constraint booking_people_person_id_fkey foreign key (person_id)
  references public.people(id) on delete cascade;

-- A share is either a flat amount (cost) or a slice of the booking
-- (cost_percent). Never both — whichever was filled in is the one that means
-- something, same rule the old rental splits used.
alter table public.booking_people add column if not exists cost_percent numeric;

-- What a point is worth on this booking, in cents. An award flight is a real
-- cost to whoever redeemed the points, so charging someone their share of it
-- needs a number to convert by.
alter table public.flights add column if not exists points_cents numeric;

create index if not exists booking_people_group_idx on public.booking_people (group_id);
