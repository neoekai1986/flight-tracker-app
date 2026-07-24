# Fare Board

A multi-user flight price tracker for sites (like Southwest) that block
automated fare lookups: organize flights into trips, open each flight's real
search page with one click, and log the prices you see. Static frontend on
GitHub Pages; auth and data live in Supabase (Postgres + Row Level Security).

## Features

- **Accounts**: email/password signup, login, password reset (Supabase Auth)
- **Trips as tabs**: each trip is a tab; flights live under their trip
- **Trip cost summary**: total paid (cash + points) at the top of each tab
- **Trip details**: travel dates, notes, attendees
- **Sharing**: trip owners invite collaborators by email; access applies
  automatically once the invitee signs up — collaborators can view and edit
- **Flights**: cash and/or points paid, alert threshold, notes, outbound /
  return legs shown side by side, drag-and-drop reordering
- **Price log**: per-flight history of manually checked prices, with delta
  vs. what you paid and a below-alert indicator
- **Import/Export**: JSON export for backup; import creates new trips; a
  one-time importer for the old localStorage-only version of this app

## Architecture

```
GitHub Pages (this repo, static index.html)
        │  supabase-js (public anon key)
        ▼
Supabase ── Auth (email/password)
        └── Postgres: trips / trip_collaborators / flights / price_logs
            protected by Row Level Security (see supabase/policies.sql)
```

The anon key embedded in `index.html` is intentionally public — Row Level
Security is the actual security boundary. Every table has RLS enabled; the
`anon` role has no table grants at all, and `authenticated` users can only
reach rows for trips they own or were invited to by email.

## Setting up your own instance

1. Create a free project at [supabase.com](https://supabase.com).
2. In Storage, create a bucket named exactly `attachments` (leave "Public
   bucket" unchecked) — this holds flight/rental screenshots. Create it via
   the dashboard, not SQL; `insert into storage.buckets` from the SQL Editor
   is unreliable and can silently abort the rest of a script.
3. In the SQL Editor, run `supabase/schema.sql`, then `supabase/policies.sql`.
4. In Authentication → URL Configuration, set your hosting URL as the Site
   URL and add it to Redirect URLs.
5. (Optional) In Authentication → Sign In / Providers → Email, disable
   "Confirm email" if you don't want signup confirmation emails.
6. Put your project URL and anon/publishable key into the two constants near
   the top of the `<script>` in `index.html`.
7. Host `index.html` anywhere static (GitHub Pages works fine).

## Notes

- Supabase free-tier projects pause after ~1 week of no activity; restoring
  is one click in the dashboard (no data loss).
- One RLS subtlety this repo already handles: the `trips` SELECT policy must
  check ownership with a direct column comparison (not a subquery through a
  helper function), or `INSERT ... RETURNING` fails with a spurious RLS
  violation — see the comment in `supabase/policies.sql`.
