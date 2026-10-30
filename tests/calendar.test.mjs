// Tests for laying flights out on the calendar.
//
// All of it is string arithmetic on ISO dates, which sort chronologically as
// plain text — so none of it makes a Date and none of it can lose a day to a
// timezone. What it can get wrong is the edges: the week a trip runs over,
// the bar that has to know it began somewhere else, and two flights on the
// same day landing on top of each other.
//
//   node tests/calendar.test.mjs

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

const C = new Function(
  extract("fmtISO") + extract("parseISODate") + extract("flightSpan") +
  extract("calendarWeeks") + extract("calendarSegments") + extract("packLanes") +
  extract("calendarTitle") +
  "return { flightSpan, calendarWeeks, calendarSegments, packLanes, calendarTitle };"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

// --- what a flight covers -------------------------------------------------
is("round trip holds the trip",
   C.flightSpan({ leg: "roundtrip", depart_date: "2026-03-23", return_date: "2026-03-29" }),
   { start: "2026-03-23", end: "2026-03-29" });
is("one way is one day",
   C.flightSpan({ leg: "oneway", depart_date: "2026-03-23" }),
   { start: "2026-03-23", end: "2026-03-23" });
// An outbound half is its own card; the return half is another. Neither
// stretches on its own.
is("an outbound half",
   C.flightSpan({ leg: "outbound", depart_date: "2026-03-23", return_date: "2026-03-29" }),
   { start: "2026-03-23", end: "2026-03-23" });
is("round trip with no return date",
   C.flightSpan({ leg: "roundtrip", depart_date: "2026-03-23", return_date: null }),
   { start: "2026-03-23", end: "2026-03-23" });
is("no date at all", C.flightSpan({ leg: "roundtrip", return_date: "2026-03-29" }), null);
// A return before the departure is a typo, not a reason to draw nothing.
is("backwards",
   C.flightSpan({ leg: "roundtrip", depart_date: "2026-03-29", return_date: "2026-03-23" }),
   { start: "2026-03-23", end: "2026-03-29" });

// --- the weeks to draw ----------------------------------------------------
const span = { start: "2026-03-23", end: "2026-03-29" };   // Mon to the Sunday after
const weeks = C.calendarWeeks([span]);
is("two weeks", weeks.length, 2);
is("starts on the Sunday before", weeks[0][0], "2026-03-22");
is("ends on the Saturday after", weeks[1][6], "2026-04-04");
is("seven days each", weeks.every(w => w.length === 7), true);
is("runs over the month end", weeks[1].slice(-4), ["2026-04-01","2026-04-02","2026-04-03","2026-04-04"]);
is("nothing to draw", C.calendarWeeks([]), []);
is("nothing but blanks", C.calendarWeeks([null, null]), []);
// Two flights months apart make one calendar covering both.
is("widest pair",
   (() => { const w = C.calendarWeeks([{ start:"2026-03-23", end:"2026-03-29" },
                                       { start:"2026-05-01", end:"2026-05-03" }]);
            return [w[0][0], w[w.length-1][6]]; })(),
   ["2026-03-22", "2026-05-09"]);
// A year typed as 2206 shouldn't ask for nine thousand weeks.
is("a mistyped year is held back",
   C.calendarWeeks([{ start: "2026-03-23", end: "2206-03-23" }]).length <= 54, true);

// --- a span cut into weekly bars ------------------------------------------
is("across the week end", C.calendarSegments(span, weeks), [
  { row: 0, from: 1, to: 6, opens: true,  closes: false },
  { row: 1, from: 0, to: 0, opens: false, closes: true  },
]);
is("a single day", C.calendarSegments({ start: "2026-03-25", end: "2026-03-25" }, weeks), [
  { row: 0, from: 3, to: 3, opens: true, closes: true },
]);
is("a whole week", C.calendarSegments({ start: "2026-03-22", end: "2026-03-28" }, weeks), [
  { row: 0, from: 0, to: 6, opens: true, closes: true },
]);
is("off the calendar", C.calendarSegments({ start: "2027-01-01", end: "2027-01-02" }, weeks), []);
is("no span", C.calendarSegments(null, weeks), []);

// --- stacking -------------------------------------------------------------
const lanes = (bars) => C.packLanes(bars).map(l => l.map(b => b.id));
is("side by side", lanes([{ id:"a", from:0, to:1 }, { id:"b", from:3, to:5 }]), [["a","b"]]);
is("overlapping", lanes([{ id:"a", from:0, to:4 }, { id:"b", from:2, to:6 }]), [["a"],["b"]]);
// Sharing a single day counts as overlapping: they'd be drawn on top of
// each other otherwise.
is("touching ends", lanes([{ id:"a", from:0, to:3 }, { id:"b", from:3, to:6 }]), [["a"],["b"]]);
is("three deep", lanes([{ id:"a", from:0, to:6 }, { id:"b", from:1, to:2 }, { id:"c", from:1, to:2 }]),
   [["a"],["b"],["c"]]);
// Two starting on the same day go longest first, so the trip that spans the
// week sits above the hop rather than under it — and the short one leaves a
// gap the third bar drops into.
is("back into the gap",
   lanes([{ id:"a", from:0, to:1 }, { id:"b", from:0, to:4 }, { id:"c", from:3, to:6 }]),
   [["b"],["a","c"]]);
is("nothing to stack", C.packLanes([]), []);

// --- what the grid is a calendar of ---------------------------------------
//
// The grid is built from a trip, not from a month, so it is routinely a week
// of one month and the first days of the next. The heading has to say both,
// and both years for a trip that sees in the new year.
const title = (start, end) => C.calendarTitle(C.calendarWeeks([{ start, end }]));

is("inside one month", title("2026-03-09", "2026-03-13"), "March 2026");
// Whole weeks: a trip inside March still shows April once the last week of
// it runs past the 31st.
is("week spilling into the next month", title("2026-03-30", "2026-03-31"),
   "March – April 2026");
is("across two months", title("2026-03-23", "2026-04-06"), "March – April 2026");
is("across the new year", title("2026-12-28", "2027-01-03"),
   "December 2026 – January 2027");
is("nothing to title", C.calendarTitle([]), "");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
