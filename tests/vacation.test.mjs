// Tests for the leave a trip costs you.
//
// Two numbers that look alike and aren't: the days a trip lasts, and the
// days of leave it takes. A long weekend is four trip days and one vacation
// day, which is the whole reason the second is typed in rather than worked
// out — but the weekdays inside the dates are where you'd start, so the
// field offers that count.
//
//   node tests/vacation.test.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  return src.slice(start, src.indexOf("\n}", start) + 2) + "\n";
}

const V = new Function(
  extract("tripWeekdayCount") + extract("vacationDaysUsed") + extract("tripDayCount") +
  "return { tripWeekdayCount, vacationDaysUsed, tripDayCount };"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

// --- the weekdays a trip falls on ----------------------------------------
// Mon 23 to Sun 29 March 2026: five working days and a weekend.
is("a week", V.tripWeekdayCount({ travel_start: "2026-03-23", travel_end: "2026-03-29" }), 5);
// Fri to Mon: the Friday and the Monday.
is("a long weekend", V.tripWeekdayCount({ travel_start: "2026-03-27", travel_end: "2026-03-30" }), 2);
// Saturday to Sunday: none at all, which is the point of a weekend.
is("a weekend", V.tripWeekdayCount({ travel_start: "2026-03-28", travel_end: "2026-03-29" }), 0);
is("one weekday", V.tripWeekdayCount({ travel_start: "2026-03-25", travel_end: "2026-03-25" }), 1);
is("a fortnight", V.tripWeekdayCount({ travel_start: "2026-03-23", travel_end: "2026-04-05" }), 10);
is("no dates, nothing to count", V.tripWeekdayCount({}), 0);
is("start only", V.tripWeekdayCount({ travel_start: "2026-03-23" }), 0);

// And it is not the length of the trip: that's the number the stats bar
// already had, and the two disagree on every trip with a weekend in it.
is("trip days are not vacation days",
   [V.tripDayCount({ travel_start: "2026-03-27", travel_end: "2026-03-30" }),
    V.tripWeekdayCount({ travel_start: "2026-03-27", travel_end: "2026-03-30" })],
   [4, 2]);

// --- what's earmarked across a set of trips -------------------------------
const trip = (vacation_days) => ({ vacation_days });

is("added up", V.vacationDaysUsed([trip(5), trip(2), trip(1)]), 8);
// Half days count: you take an afternoon off to make a Friday flight.
is("half days", V.vacationDaysUsed([trip(4.5), trip(0.5)]), 5);
// Nobody has said, which is not the same as nought — the bar shows a dash
// for the first and a 0 for the second.
is("nothing said", V.vacationDaysUsed([trip(null), trip(undefined), {}]), null);
is("said nought", V.vacationDaysUsed([trip(0)]), 0);
is("some said", V.vacationDaysUsed([trip(null), trip(3)]), 3);
is("no trips", V.vacationDaysUsed([]), null);
// A column that hasn't been written to yet comes back as text from some
// paths; a number is a number.
is("read as text", V.vacationDaysUsed([trip("3"), trip("1.5")]), 4.5);
is("read as nonsense", V.vacationDaysUsed([trip("lots")]), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
