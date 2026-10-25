-- Migration: move the old rental "who paid what" splits into booking_people,
-- so there's one way to express a share instead of two.
-- Run once in the SQL Editor. Safe to run more than once.
--
-- rentals.splits is a jsonb array of {name, percent, amount} naming the OTHER
-- people on a booking, with the remainder falling to whoever paid. That's the
-- same meaning booking_people already has, so this is a straight move rather
-- than a reinterpretation.

-- Names in the old splits become real people, one per distinct name.
insert into public.people (owner_id, name, position)
select distinct on (t.owner_id, lower(sp.name))
       t.owner_id, sp.name, 0
from public.rentals r
join public.trips t on t.id = r.trip_id
cross join lateral jsonb_to_recordset(r.splits) as sp(name text, percent numeric, amount numeric)
where coalesce(trim(sp.name), '') <> ''
  and not exists (
    select 1 from public.people p
    where p.owner_id = t.owner_id and lower(p.name) = lower(trim(sp.name))
  );

-- Then the shares themselves. A split carried either a flat amount or a
-- percent; whichever was set is the one that meant anything, which is exactly
-- how cost / cost_percent behave.
insert into public.booking_people (trip_id, rental_id, person_id, cost, cost_percent)
select r.trip_id, r.id, p.id, sp.amount, sp.percent
from public.rentals r
join public.trips t on t.id = r.trip_id
cross join lateral jsonb_to_recordset(r.splits) as sp(name text, percent numeric, amount numeric)
join public.people p on p.owner_id = t.owner_id and lower(p.name) = lower(trim(sp.name))
where coalesce(trim(sp.name), '') <> ''
  and (sp.amount is not null or sp.percent is not null)
  and not exists (
    select 1 from public.booking_people bp
    where bp.rental_id = r.id and bp.person_id = p.id
  );

-- Anyone brought over this way is on that trip, so put them on its roster.
insert into public.trip_people (trip_id, person_id, name, position)
select distinct bp.trip_id, bp.person_id, p.name, 0
from public.booking_people bp
join public.people p on p.id = bp.person_id
where bp.person_id is not null
  and not exists (
    select 1 from public.trip_people tp
    where tp.trip_id = bp.trip_id and tp.person_id = bp.person_id
  );

-- Emptied rather than dropped: nothing reads it after this, and keeping the
-- column means the move is reversible from a backup if a figure looks wrong.
update public.rentals set splits = '[]'::jsonb
where splits is not null and splits <> '[]'::jsonb;
