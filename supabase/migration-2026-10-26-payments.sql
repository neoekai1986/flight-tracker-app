-- Migration: record that someone has paid up.
-- Run once in the SQL Editor. Safe to run more than once.

-- Shares say what people owe. Nothing until now said what they had handed
-- over, so a trip stayed outstanding forever and you had to remember who had
-- settled. A payment moves money between two people on a trip: it leaves the
-- shares alone, because what someone owed is still true after they've paid
-- it, and adjusts what each of them has laid out.
create table if not exists public.trip_payments (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  -- Who handed the money over.
  from_person  uuid not null references public.people(id) on delete cascade,
  -- Who received it. Null means you, which is nearly always the case and
  -- saves picking your own name every time.
  to_person    uuid references public.people(id) on delete set null,
  amount       numeric not null,
  paid_on      date not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists trip_payments_trip_idx on public.trip_payments (trip_id, paid_on);

alter table public.trip_payments enable row level security;
revoke all on public.trip_payments from anon;
grant select, insert, update, delete on public.trip_payments to authenticated;

-- Same access as the trip itself: can_access_trip() is the security-definer
-- helper the other trip-scoped tables already use, so a collaborator sees
-- the payments on a trip they're on and nothing else.
drop policy if exists trip_payments_select on public.trip_payments;
create policy trip_payments_select on public.trip_payments
  for select using ( public.can_access_trip(trip_id) );
drop policy if exists trip_payments_insert on public.trip_payments;
create policy trip_payments_insert on public.trip_payments
  for insert with check ( public.can_access_trip(trip_id) );
drop policy if exists trip_payments_update on public.trip_payments;
create policy trip_payments_update on public.trip_payments
  for update using ( public.can_access_trip(trip_id) ) with check ( public.can_access_trip(trip_id) );
drop policy if exists trip_payments_delete on public.trip_payments;
create policy trip_payments_delete on public.trip_payments
  for delete using ( public.can_access_trip(trip_id) );
