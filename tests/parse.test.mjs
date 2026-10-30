// Tests for reading a pasted search result.
//
// The thing this guards is the difference between a leg and its layover. A
// result prints both the same way — a one-stop IAD-RNO carries "7h 46m" for
// the journey and "1h 03m" sitting in ORD — and taking them in bare order
// put 1h 03m on the card for a flight across the country.
//
//   node tests/parse.test.mjs

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

const parse = new Function(
  extract("parseFlightResultText") + "return parseFlightResultText;"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

// The flight that found this: United, IAD-RNO over ORD out and SFO back,
// with each leg's layover printed beside it.
const united = `
8:35 AM – 1:21 PM
IAD – RNO
United
1 stop  ORD
1h 03m layover in ORD
7h 46m

1:42 PM – 1:17 AM
RNO – IAD
United
1 stop  SFO
1h 28m layover in SFO
8h 35m
`;
{
  const r = parse(united);
  is("united legs", r.ranges, 2);
  is("united out times", [r.departTime, r.arriveTime], ["08:35", "13:21"]);
  is("united back times", [r.returnTime, r.returnArriveTime], ["13:42", "01:17"]);
  is("united durations", r.durations, ["7h 46m", "8h 35m"]);
  is("united stops", r.stops, ["1 stop (ORD)", "1 stop (SFO)"]);
}

// The same result with the journey printed before its layover: which one
// comes first must not decide it.
{
  const r = parse(united.replace("1h 03m layover in ORD\n7h 46m",
                                 "7h 46m\n1h 03m layover in ORD"));
  is("order-independent", r.durations, ["7h 46m", "8h 35m"]);
}

// A plain nonstop round trip, one duration per leg, reads as it always did.
const kayak = `
7:35 am – 10:05 am   BWI–DEN   Alaska   5h 30m   nonstop
2:40 pm – 8:15 pm    DEN–BWI   Alaska   4h 35m   1 stop
$412
`;
{
  const r = parse(kayak);
  is("kayak durations", r.durations, ["5h 30m", "4h 35m"]);
  is("kayak stops", r.stops, ["nonstop", "1 stop"]);
  is("kayak price", r.price, 412);
}

// One way: one leg, one duration, and nothing invented for a second.
{
  const r = parse("9:10 pm – 11:59 pm  SMF–SEA  1h 55m  nonstop");
  is("one way", r.durations, ["1h 55m"]);
  is("one way return", r.returnTime, null);
}

// A leg whose duration the result never states keeps its place in the list
// rather than borrowing the other leg's.
{
  const r = parse(`
6:00 am – 9:30 am  IAD–ORD  nonstop
4:00 pm – 7:00 pm  ORD–IAD  nonstop  1h 45m
`);
  is("missing duration", r.durations, [null, "1h 45m"]);
}

// With no times to divide by there are no legs, so the durations stand as
// they were found.
{
  const r = parse("Flight time 4h 54m, then 3h 56m home");
  is("no times", r.durations, ["4h 54m", "3h 56m"]);
}

// Every spelling a result uses for a duration. Google Flights writes it
// long, Kayak short; the card shows one form either way.
{
  const long = `8:35 AM – 1:21 PM
IAD – RNO
1 stop ORD
1 hr 3 min layover in ORD
7 hr 46 min`;
  is("hr/min", parse(long).durations, ["7h 46m"]);
  is("hours/minutes", parse("8:35 AM – 1:21 PM  7 hours 46 minutes").durations, ["7h 46m"]);
  is("hrs", parse("8:35 AM – 1:21 PM  3 hrs").durations, ["3h"]);
  is("mins alone", parse("9:10 pm – 11:59 pm  55 mins").durations, ["55m"]);
  is("minutes alone", parse("9:10 pm – 11:59 pm  55 minutes").durations, ["55m"]);
  // And the short forms still read as they did.
  is("short still works", parse("7:35 am – 10:05 am  5h 30m").durations, ["5h 30m"]);
}

// A word that merely starts with h or m is not a duration.
{
  is("not miles", parse("8:35 AM – 1:21 PM  5 miles from the airport").durations, [null]);
  is("not months", parse("8:35 AM – 1:21 PM  book 3 months ahead").durations, [null]);
}

// ---- Dates ----
//
// The date was the one thing a pasted result never gave up, so the box kept
// whatever the trip's own travel window had put there and the flight was
// filed on the wrong day.

// Google Flights, with the year stated and each leg's date repeated beside
// its times. Each date counts once, in the order it first appears.
{
  const r = parse(`
Mon, Mar 23, 2026
8:35 AM – 1:21 PM  IAD – RNO  United  1 stop ORD  7h 46m
Mon, Mar 23, 2026

Sun, Mar 29, 2026
1:42 PM – 1:17 AM  RNO – IAD  United  1 stop SFO  8h 35m
Sun, Mar 29, 2026
`);
  is("gflights dates", r.dates, ["2026-03-23", "2026-03-29"]);
}

// A search header stating the range, then the legs: still the depart date
// first and the return second.
{
  const r = parse(`Mar 23 – Mar 29, 2026
8:35 AM – 1:21 PM  IAD–RNO
1:42 PM – 1:17 AM  RNO–IAD`);
  is("range header", r.dates, ["2026-03-23", "2026-03-29"]);
}

// The year is usually missing, and is read against the date the form holds.
{
  is("yearless vs ref", parse("Mon, Mar 23\n8:35 AM – 1:21 PM", "2026-03-20").dates,
     ["2026-03-23"]);
  // A January flight found in December belongs to the year ahead, not eleven
  // months behind.
  is("rolls forward", parse("Jan 5", "2026-12-28").dates, ["2027-01-05"]);
  // And the mirror: December shown while the form sits in January.
  is("rolls back", parse("Dec 28", "2027-01-05").dates, ["2026-12-28"]);
  // Inside six months it stays on the reference year.
  is("stays put", parse("Aug 14", "2026-03-20").dates, ["2026-08-14"]);
}

// A range header states the year once, at the end, and the day before it
// belongs to the year its own month implies — the December half of a
// New Year trip is the year before the January half.
{
  is("header year shared", parse("Mar 23 - Mar 29, 2026").dates,
     ["2026-03-23", "2026-03-29"]);
  is("header year across new year", parse("Dec 28 - Jan 3, 2027").dates,
     ["2026-12-28", "2027-01-03"]);
}

// The other spellings a result might use.
{
  is("slashes", parse("3/23/26  8:35 AM").dates, ["2026-03-23"]);
  is("slashes long year", parse("3/23/2026").dates, ["2026-03-23"]);
  is("iso", parse("2026-03-23 departs 8:35 AM").dates, ["2026-03-23"]);
  is("day first", parse("23 Mar 2026").dates, ["2026-03-23"]);
  is("abbreviated", parse("Sept. 4th, 2026").dates, ["2026-09-04"]);
}

// Times, routes, prices and durations are not dates.
{
  is("no dates in kayak row", parse(kayak).dates, []);
  is("no dates at all", parse("8:35 AM – 1:21 PM  IAD–RNO  $412  7h 46m").dates, []);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
