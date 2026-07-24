-- Migration: screenshot attachments for flights/rentals, plus flight
-- number / confirmation code fields. For projects created before this
-- feature. Run once in the SQL Editor. (Fresh installs don't need this —
-- schema.sql/policies.sql already include it.)
--
-- IMPORTANT — do this FIRST, before running the SQL below: create a Storage
-- bucket named exactly "attachments" via the Supabase dashboard (Storage >
-- New bucket, "Public bucket" left UNCHECKED). Creating it via SQL
-- (`insert into storage.buckets`) is unreliable — it can silently fail or
-- abort the rest of this script depending on the project's permissions.

alter table public.flights
  add column flight_number text,
  add column confirmation_code text;

alter table public.rentals
  add column confirmation_code text;

-- Screenshots attached to a flight or rental (confirmation emails, boarding
-- passes, listing pages). The actual image bytes live in Storage under the
-- "attachments" bucket, at path "{trip_id}/{uuid}.{ext}"; this row is the
-- metadata + OCR text extracted from it client-side (Tesseract.js — no
-- server call, so ocr_text is best-effort raw text, not verified fields).
create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  flight_id   uuid references public.flights(id) on delete cascade,
  rental_id   uuid references public.rentals(id) on delete cascade,
  storage_path text not null,
  filename    text,
  ocr_text    text,
  created_at  timestamptz not null default now(),
  check ( (flight_id is not null)::int + (rental_id is not null)::int = 1 )
);

create index on public.attachments (flight_id);
create index on public.attachments (rental_id);

alter table public.attachments enable row level security;
revoke all on public.attachments from anon;
grant select, insert, update, delete on public.attachments to authenticated;

create policy attachments_select on public.attachments
  for select using ( public.can_access_trip(trip_id) );

create policy attachments_insert on public.attachments
  for insert with check ( public.can_access_trip(trip_id) );

create policy attachments_update on public.attachments
  for update using ( public.can_access_trip(trip_id) )
  with check ( public.can_access_trip(trip_id) );

create policy attachments_delete on public.attachments
  for delete using ( public.can_access_trip(trip_id) );

-- Storage: screenshots live at "{trip_id}/{uuid}.{ext}" — the first path
-- segment is the trip id, so RLS can scope access the same way every
-- other table does. No update policy: attachments are replace-by-delete.
create policy attachments_storage_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );

create policy attachments_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );

create policy attachments_storage_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and public.can_access_trip( (split_part(name, '/', 1))::uuid )
  );
