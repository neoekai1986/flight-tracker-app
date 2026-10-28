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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
