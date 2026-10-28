# Tests

No framework, no install. Plain Node, run from the directory holding
`index.html` — not from its parent:

    cd ~/Downloads/flight-tracker-app
    for t in tests/*.test.mjs; do node "$t" || break; done

Both read `index.html` and pull the functions they test straight out of it by
name, so there's nothing to keep in step and no build step. If you rename one
of those functions the test will say so rather than silently passing.

- **form.test.mjs** — reading share rows off the form, which is where input
  has twice been lost between the box and the database. The settlement and
  the adapter were both tested while this step wasn't, so a share could
  vanish between them with every suite green.
- **brand.test.mjs** — which company a card belongs to. A listing's URL
  outranks its label, and a name only matches inside its own kind, so a
  cabin called "Alaska" doesn't fly on Alaska.
- **parse.test.mjs** — reading a pasted search result. A result prints a
  layover the way it prints a leg, so the parser has to tell the journey from
  the hour spent waiting in the middle of it.
- **settlement.test.mjs** — the arithmetic. `settleTrip()` takes plain data
  and returns plain data, so it can be exercised directly. Every case asserts
  that the shares add up to exactly what the trip cost.
- **adapter.test.mjs** — the translation between stored rows and that
  function: households, percentages, per-seat flight pricing, points,
  watching items, and share rows left pointing at nobody.
- **keystone.test.mjs** — the real Keystone trip, copied out of the database,
  including the companion seat.
- **hiddenvalley.test.mjs** — the real Hidden Valley rental, rows copied
  verbatim including a zero that shouldn't have been written. Every other
  suite passed throughout that bug because they build rows the way the model
  assumes rather than the way the form wrote them. When a figure is wrong in
  the app but right in the tests, copy the rows out of the database.
  This is the case that was reported wrong three times; it's here so it can't
  go wrong a fourth time without something failing.

Run both after touching anything under the two `Settlement` headings in
`index.html`. Three attempts at fixing the totals by hand went wrong before
these existed.
