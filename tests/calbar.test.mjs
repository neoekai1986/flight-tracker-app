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

const calbar = new Function(
  extractConst("esc") + extractConst("fmtCash") + extractConst("fmtCashShort")
  + extractConst("fmtPoints")
  + extractConst("pointsText") + extractConst("BRANDS") + extractConst("brandInitials")
  + extract("fmtTime") + extract("fmtShortDate") + extract("flightTitle")
  + extract("flightCardTitle") + extract("latestPriceLog") + extract("calendarPrice")
  + extract("flightTotalText") + extract("safeExternalUrl") + extract("brandHost")
  + extract("brandInk") + extract("brandFor") + extract("brandMark")
  + extract("calendarBarHTML") + extract("calendarStayBarHTML")
  + "return { calendarBarHTML, calendarStayBarHTML };"
)();
const { calendarBarHTML, calendarStayBarHTML } = calbar;

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

// The row the trip starts on carries everything: the airline, the route, the
// price beside it, and the day's times.
{
  const html = bar(united, { from: 1, to: 6, opens: true, closes: false });
  is("week one text", text(html), "UA IAD ⇄ RNO $412 8:35 AM – 1:21 PM");
  is("week one has the cost", /tcal-cost/.test(html), true);
}

// The row below carries the price too. It is the same fare, but a bar with
// no figure on it reads as a flight nobody priced, and that was the whole
// complaint. The route goes instead — the row above just said it.
{
  const html = bar(united, { from: 0, to: 0, opens: false, closes: true });
  is("week two text", text(html), "$412");
  is("week two keeps the cost", /tcal-cost/.test(html), true);
  is("week two drops the route", /tcal-route/.test(html), false);
}

// A continuation wide enough for both keeps both.
{
  const html = bar(united, { from: 0, to: 3, opens: false, closes: true });
  is("wide continuation", text(html), "IAD ⇄ RNO $412");
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
  is("one day text", text(html), "IAD → RNO $412");
  is("one day drops the times", /tcal-time/.test(html), false);
  is("one day is a tighter box", /tcal-bar-day/.test(html), true);
}

// The cents are dropped on a bar — three characters of a column, and the
// exact figure is on the card and in the tooltip.
{
  const odd = { ...united, paid_cash: 1183.47 };
  const html = bar(odd, { from: 1, to: 6, opens: true, closes: true });
  is("no cents on the bar", /\$1,183\b(?!\.)/.test(text(html)), true);
  is("cents in the tooltip", /\$1,183\.47/.test(html), true);
}

// Points instead of cash, multiplied out by the seats, with the program name
// left to the tooltip — it doesn't fit on a bar.
{
  const award = { ...united, paid_cash: null, paid_points: 22000,
                  points_program: "Southwest Rapid Rewards", passengers: 2 };
  const html = bar(award, { from: 1, to: 6, opens: true, closes: true });
  is("points cost", /44,000 pts/.test(text(html)), true);
  is("program in the tooltip", /Southwest Rapid Rewards/.test(html), true);
}

// A flight with nothing recorded says so with a dash, rather than leaving a
// gap that reads as a bar which failed to draw its price.
{
  const free = { ...united, paid_cash: null, paid_points: null };
  const html = bar(free, { from: 1, to: 6, opens: true, closes: true });
  is("nothing recorded", text(html), "UA IAD ⇄ RNO — 8:35 AM – 1:21 PM 1:42 PM – 1:17 AM");
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

// ---- The latest check ----
//
// A card holds two figures: what it was saved at, and the last price checked
// against it. On a flight you're watching they're rarely the same, and the
// calendar was showing only the first.

const checked = (logs) => ({ ...united, price_logs: logs });

{
  const html = bar(checked([
    { date: "2026-01-02", price: 412, created_at: "2026-01-02T10:00:00Z" },
    { date: "2026-02-14", price: 366, created_at: "2026-02-14T10:00:00Z" },
  ]), { from: 1, to: 6, opens: true, closes: true });
  is("both figures", text(html),
     "UA IAD ⇄ RNO $412 ↓ $366 8:35 AM – 1:21 PM 1:42 PM – 1:17 AM");
  is("the check is in the tooltip", /checked \$366 Feb 14/.test(html), true);
}

// Up as well as down, and the arrow is the only thing that says which.
{
  const html = bar(checked([{ date: "2026-02-14", price: 505 }]),
                   { from: 1, to: 6, opens: true, closes: true });
  is("a rise", /↑ \$505/.test(text(html)), true);
}

// The newest check is the one shown — by the date it's for, not by the order
// the rows came back in.
{
  const html = bar(checked([
    { date: "2026-02-14", price: 366, created_at: "2026-02-14T10:00:00Z" },
    { date: "2026-03-01", price: 390, created_at: "2026-03-01T10:00:00Z" },
    { date: "2026-01-02", price: 412, created_at: "2026-01-02T10:00:00Z" },
  ]), { from: 1, to: 6, opens: true, closes: true });
  is("newest by date", /↓ \$390/.test(text(html)), true);
}

// Two checks on one day: price_logs only records the date, so the one typed
// in later wins.
{
  const html = bar(checked([
    { date: "2026-03-01", price: 390, created_at: "2026-03-01T09:00:00Z" },
    { date: "2026-03-01", price: 377, created_at: "2026-03-01T18:00:00Z" },
  ]), { from: 1, to: 6, opens: true, closes: true });
  is("same day, later entry", /↓ \$377/.test(text(html)), true);
}

// A check that came back at the price on the card says nothing: "$412 $412"
// is two figures where there is only one.
{
  const html = bar(checked([{ date: "2026-02-14", price: 412 }]),
                   { from: 1, to: 6, opens: true, closes: true });
  is("unchanged shows once", text(html),
     "UA IAD ⇄ RNO $412 8:35 AM – 1:21 PM 1:42 PM – 1:17 AM");
  is("and no second figure", /tcal-now/.test(html), false);
}

// Points are checked in points, against the points the card holds, and both
// are multiplied out by the seats.
{
  const award = { ...united, paid_cash: null, paid_points: 22000, passengers: 2,
                  price_logs: [{ date: "2026-02-20", price: 26500, is_points: true }] };
  const html = bar(award, { from: 1, to: 6, opens: true, closes: true });
  is("points check", /44,000 pts ↑ 53,000 pts/.test(text(html)), true);
}

// A flight never priced, only watched, shows the check on its own.
{
  const watched = { ...united, paid_cash: null, paid_points: null, status: "watching",
                    price_logs: [{ date: "2026-02-14", price: 366 }] };
  const html = bar(watched, { from: 1, to: 6, opens: true, closes: true });
  is("check with nothing to compare", text(html),
     "UA IAD ⇄ RNO $366 8:35 AM – 1:21 PM 1:42 PM – 1:17 AM");
}

// The one-column continuation has room for the price but not for both
// figures; the one on the card is the one it keeps.
{
  const html = bar(checked([{ date: "2026-02-14", price: 366 }]),
                   { from: 0, to: 0, opens: false, closes: true });
  is("continuation keeps the saved price", text(html), "$412");
  is("and leaves the check to the wider row", /tcal-now/.test(html), false);
}

// ---- Stays and cars ----
//
// The same grid carries them, because a trip is a flight and several nights
// and the point of a calendar is seeing where one sits against the other.
// Less to say than a flight: no times, no route, so the name and the price.
const stay = (over, item = {}) => calendarStayBarHTML({
  r: { id: "r1", kind: "housing", label: "Airbnb — Incline Village",
       url: "https://www.airbnb.com/rooms/1", paid_cash: 1180, currency: "USD",
       status: "booked", ...item },
  lane: 0, ...over,
});

{
  const html = stay({ from: 1, to: 6, opens: true, closes: true });
  is("a stay says what and how much", text(html), "A Airbnb — Incline Village $1,180");
  is("drawn apart from the flights", /tcal-bar-stay/.test(html), true);
  is("and goes back to its own card", /data-tcal-stay="r1"/.test(html), true);
}

// The brand is looked up in its own kind: a car company and a hotel chain
// can share a name, and Budget is not an airline.
{
  const car = stay({ from: 1, to: 4, opens: true, closes: true },
                   { kind: "car", label: "Budget — RNO airport",
                     url: "https://www.budget.com/x", paid_cash: 214 });
  is("a car", text(car), "B Budget — RNO airport $214");
}

// Nothing recorded reads as nothing recorded here too.
{
  const html = stay({ from: 1, to: 6, opens: true, closes: true },
                    { paid_cash: null, label: "Hyatt Place Orlando", url: null });
  is("a stay with no price", text(html), "H Hyatt Place Orlando —");
}

// Watching is watching, whatever it's a booking for.
{
  const html = stay({ from: 1, to: 6, opens: true, closes: true }, { status: "watching" });
  is("watching stay", /tcal-bar-watching/.test(html), true);
}

// And the row below behaves the way a flight's does: the price, no name.
{
  const html = stay({ from: 0, to: 0, opens: false, closes: true });
  is("stay continuation", text(html), "$1,180");
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
