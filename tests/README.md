# Tests

No framework, no install. Plain Node, run from the directory holding
`index.html` — not from its parent:

    cd ~/Downloads/flight-tracker-app
    node tests/settlement.test.mjs && node tests/adapter.test.mjs

Both read `index.html` and pull the functions they test straight out of it by
name, so there's nothing to keep in step and no build step. If you rename one
of those functions the test will say so rather than silently passing.

- **settlement.test.mjs** — the arithmetic. `settleTrip()` takes plain data
  and returns plain data, so it can be exercised directly. Every case asserts
  that the shares add up to exactly what the trip cost.
- **adapter.test.mjs** — the translation between stored rows and that
  function: households, percentages, per-seat flight pricing, points,
  watching items, and share rows left pointing at nobody.

Run both after touching anything under the two `Settlement` headings in
`index.html`. Three attempts at fixing the totals by hand went wrong before
these existed.
