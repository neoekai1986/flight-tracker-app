// Tests for what one bar on the calendar says.
//
// A trip that ends on a Sunday ends at the end of a week, so its last day
// draws as a bar one column wide on the row below. That lone cell carries
// the price — and it was failing a width test, which took the price off the
// calendar entirely for exactly the trips you most want to price: the ones
// long enough to run over a weekend.
//
//   node tests/calbar.test.mjs

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
// A const runs to whichever closing line sits at column zero.
function extractConst(name){
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  const head = src.slice(start, src.indexOf("\n", start)).trimEnd();
  const close = head.endsWith("[") ? "\n];" : head.endsWith("{") ? "\n};" : null;
  if (!close) return src.slice(start, src.indexOf(";\n", start) + 2) + "\n";
  return src.slice(start, src.indexOf(close, start) + close.length) + "\n";
}

const calendarBarHTML = new Function(
  extractConst("esc") + extractConst("fmtCash") + extractConst("fmtPoints")
  + extractConst("pointsText") + extractConst("BRANDS") + extractConst("brandInitials")
  + extract("fmtTime") + extract("flightTitle") + extract("flightCardTitle")
  + extract("flightTotalText") + extract("safeExternalUrl") + extract("brandHost")
  + extract("brandInk") + extract("brandFor") + extract("brandMark")
  + extract("calendarBarHTML")
  + "return calendarBarHTML;"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

// The IAD-RNO round trip: out Monday the 23rd, back Sunday the 29th. Weeks
// start on Sunday, so it draws as Mon-Sat on one row and the 29th alone on
// the next.
const united = {
  id: "f1", leg: "roundtrip", origin: "iad", destination: "rno",
  depart_date: "2026-03-23", return_date: "2026-03-29",
  depart_time: "08:35", arrive_time: "13:21",
  return_time: "13:42", return_arrive_time: "01:17",
  airline: "United", paid_cash: 412, currency: "USD", passengers: 1,
  status: "booked",
};
const text = html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const bar = (f, over) => calendarBarHTML({ f, lane: 0, ...over });

// The long first row: route, the day's times, no price yet.
{
  const html = bar(united, { from: 1, to: 6, opens: true, closes: false });
  is("week one text", text(html), "UA IAD ⇄ RNO 8:35 AM – 1:21 PM");
  is("week one has no cost", /tcal-cost/.test(html), false);
}

// The one cell on the row below: the price, which is what that row is for.
{
  const html = bar(united, { from: 0, to: 0, opens: false, closes: true });
  is("week two text", text(html), "$412.00");
  is("week two has the cost", /tcal-cost/.test(html), true);
  // The route is on the row above; repeating it here would leave no room.
  is("week two drops the route", /tcal-route/.test(html), false);
}

// The same trip when it happens to fit inside one week: everything on it.
{
  const html = bar(united, { from: 1, to: 6, opens: true, closes: true });
  is("one row keeps the route", /tcal-route/.test(html), true);
  is("one row keeps the cost", /tcal-cost/.test(html), true);
}

// A one-day flight is one column wide and still says what it cost.
{
  const oneway = { ...united, leg: "oneway", return_date: null, return_time: null,
                   return_arrive_time: null };
  const html = bar(oneway, { from: 3, to: 3, opens: true, closes: true });
  is("one day text", text(html), "IAD → RNO $412.00");
  is("one day drops the times", /tcal-time/.test(html), false);
}

// Points instead of cash, multiplied out by the seats, with the program name
// left to the tooltip — it doesn't fit on a bar.
{
  const award = { ...united, paid_cash: null, paid_points: 22000,
                  points_program: "Southwest Rapid Rewards", passengers: 2 };
  const html = bar(award, { from: 0, to: 0, opens: false, closes: true });
  is("points cost", text(html), "44,000 pts");
  is("program in the tooltip", /Southwest Rapid Rewards/.test(html), true);
}

// A flight with no price to show keeps its route rather than drawing an
// empty bar.
{
  const free = { ...united, paid_cash: null, paid_points: null };
  const html = bar(free, { from: 0, to: 0, opens: false, closes: true });
  is("no price keeps the route", text(html), "IAD ⇄ RNO");
}

// Watching stays visibly different from booked, and the tooltip says so.
{
  const watch = { ...united, status: "watching" };
  const html = bar(watch, { from: 1, to: 6, opens: true, closes: true });
  is("watching class", /tcal-bar-watching/.test(html), true);
  is("watching in the tooltip", /watching/.test(html), true);
}

// The bar is the flight's own way back to its card.
{
  const html = bar(united, { from: 1, to: 6, opens: true, closes: true });
  is("carries the flight id", /data-tcal-flight="f1"/.test(html), true);
  is("spans its own columns", /grid-column:2\/8/.test(html), true);
}

// ---- The C key ----
//
// The shortcut clicks the button rather than repeating what the button does,
// so the two can't drift apart. Driven here out of the file itself: the
// handler is an anonymous listener, so the test runs the real statement with
// a stand-in document rather than a copy of its logic.
const viewKeyCode = (() => {
  const start = src.indexOf("const VIEW_KEYS = ");
  if (start < 0) throw new Error("VIEW_KEYS not found in index.html");
  const end = src.indexOf("\n});", start);
  if (end < 0) throw new Error("the keydown listener after VIEW_KEYS not found");
  return src.slice(start, end + 4);
})();

// Stand-in for a focused element: all the handler asks of one is whether it
// sits inside a field.
class StubElement {
  constructor(inField = false){ this.inField = inField; }
  closest(q){ return this.inField && /input|textarea|select/.test(q) ? this : null; }
}

function keys(tripId = "t1"){
  const clicked = [];
  const button = (attr) => ({ click(){ clicked.push(attr); } });
  const buttons = {
    [`[data-trip-summary="${tripId}"]`]: button("summary"),
    [`[data-trip-calendar="${tripId}"]`]: button("calendar"),
  };
  let listener = null;
  const doc = {
    addEventListener(type, fn){ if (type === "keydown") listener = fn; },
    querySelector: (sel) => buttons[sel] || null,
  };
  new Function("document", "activeTripId", "Element", viewKeyCode)(doc, tripId, StubElement);
  if (!listener) throw new Error("no keydown listener was registered");
  return {
    clicked,
    press(key, over = {}){
      let prevented = false;
      listener({ key, target: null, preventDefault(){ prevented = true; }, ...over });
      return prevented;
    },
  };
}

{
  const k = keys();
  is("c opens the calendar", (k.press("c"), k.clicked), ["calendar"]);
  is("and takes the keypress", k.press("c"), true);
  is("C does too", (keys().press("C"), true), true);
}
{
  const k = keys();
  k.press("s");
  is("s is the summary", k.clicked, ["summary"]);
}
// Cmd+C stays the browser's, and so does every other key.
{
  const k = keys();
  k.press("c", { metaKey: true });
  k.press("c", { ctrlKey: true });
  k.press("c", { altKey: true });
  k.press("k");
  is("modifiers and other keys are left alone", k.clicked, []);
}
// Typing a c into any field is a c, not a view change — the airline box and
// the paste box would both be unusable otherwise.
{
  const k = keys();
  is("not while typing", k.press("c", { target: new StubElement(true) }), false);
  is("nothing clicked while typing", k.clicked, []);
}
// A trip with no buttons on screen yet swallows nothing.
{
  const k = keys("t1");
  const other = keys("t2");
  is("keyed to the trip on screen", (other.press("c"), other.clicked), ["calendar"]);
  is("and not to any other", k.clicked, []);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
