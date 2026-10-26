// Tests for the layer between the database and the settlement maths.
//
// settlement.test.mjs covers the arithmetic. This covers the translation:
// stored rows in, settlement input out, dollars back. That's where the
// awkward cases live — a share row pointing at a household instead of a
// person, a percentage instead of an amount, a roster entry never linked to
// anyone — and it's where the numbers went wrong before.
//
//   node tests/adapter.test.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

// Top-level functions close with a brace at column zero; one-liners don't, so
// they're taken a line at a time.
function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  const firstLine = src.slice(start, src.indexOf("\n", start));
  if (firstLine.trimEnd().endsWith("}")) return firstLine + "\n";
  return src.slice(start, src.indexOf("\n}", start) + 2) + "\n";
}

function extractConst(name){
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  const firstLine = src.slice(start, src.indexOf("\n", start));
  // An object literal runs to a "};" at column zero; everything else is a
  // one-liner.
  if (!firstLine.trimEnd().endsWith("{")) return firstLine + "\n";
  return src.slice(start, src.indexOf("\n};", start) + 3) + "\n";
}

const names = ["bookingCents", "splitCents", "settleTrip", "selfPerson", "personById",
  "groupById", "tripPeople", "personName", "bookingPeopleFor", "settlementBooking",
  "settlementBookings", "settlementGroups", "settlementFor", "tripMoney", "tripPayments",
  "flightTicketCost", "settleOne", "myShareOf", "settlementSubjectName",
  "rentalOurPortion", "rentalSplitText", "shareParts", "parsePercent", "reasonText"];

// The app's globals, supplied by the test rather than by a page load. esc and
// fmtCash are display helpers and are stubbed to keep assertions readable.
const app = new Function("state", `
  const { people, personGroups, trips } = state;
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtCash = (n) => "$" + Number(n).toFixed(2);
  ${extractConst("toCents")}${extractConst("fromCents")}
  ${extractConst("SELF")}${extractConst("selfId")}${extractConst("SHARE_BASIS")}
  ${names.map(extract).join("")}
  return { tripMoney, rentalOurPortion, rentalSplitText, myShareOf, parsePercent, reasonText,
           settlementGroups, settlementBooking, flightTicketCost, settlementFor };
`);

let passed = 0, failed = 0;
const stable = v => (v && typeof v === "object" && !Array.isArray(v))
  ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : 1)))
  : JSON.stringify(v);
function check(name, got, want){
  if (stable(got) === stable(want)) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      got  ${stable(got)}`);
    console.log(`      want ${stable(want)}`);
  }
}

// A trip shaped like the real thing: a master people list, a household, a
// roster, and bookings with per-person share rows.
function world(over = {}){
  const people = [
    { id: "p-me",  name: "Me",        is_self: true },
    { id: "p-eug", name: "Eugene",    group_id: "g-ec" },
    { id: "p-chr", name: "Christine", group_id: "g-ec" },
    { id: "p-jay", name: "Jay" },
  ];
  const personGroups = [{ id: "g-ec", name: "Eugene & Christine" }];
  const trip = Object.assign({
    id: "t1", title: "Keystone",
    trip_people: [{ person_id: "p-me" }, { person_id: "p-eug" },
                  { person_id: "p-chr" }, { person_id: "p-jay" }],
    flights: [], rentals: [], booking_people: [],
  }, over);
  const state = { people, personGroups, trips: [trip] };
  return { trip, api: app(state) };
}

const owed = m => Object.fromEntries(m.rows.map(r => [r.name, r.owes]));
const paid = m => Object.fromEntries(m.rows.map(r => [r.name, r.paid]));

// ---- the roster always shows ----------------------------------------------

{
  const { trip, api } = world();
  const m = api.tripMoney(trip);
  check("everyone on the trip gets a row, even with nothing booked", owed(m),
    { Me: 0, Eugene: 0, Christine: 0, Jay: 0 });
  check("nothing booked, nothing owed", m.total, 0);
}

// ---- the reported bug: shares entered, summary showing zero ---------------

{
  // A lodge paid by me, with flat amounts entered against two people.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug", cost: 300 },
      { rental_id: "r1", person_id: "p-chr", cost: 300 },
    ],
  });
  const m = api.tripMoney(trip);
  check("flat amounts land on the people they name", owed(m),
    { Me: 300, Eugene: 300, Christine: 300, Jay: 0 });
  check("the payer is credited the whole bill", paid(m),
    { Me: 900, Eugene: 0, Christine: 0, Jay: 0 });
  check("and it totals the booking", m.total, 900);
  check("your share of it matches the table", api.rentalOurPortion(trip.rentals[0]), 300);
}

{
  // The same lodge, charged to the household as one subject — how housing is
  // actually offered in the form.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", group_id: "g-ec" },
      { rental_id: "r1", person_id: "p-me" },
    ],
  });
  const m = api.tripMoney(trip);
  check("a household share divides between its members", owed(m),
    { Me: 450, Eugene: 225, Christine: 225, Jay: 0 });
  check("the card names the household, not its members",
    api.rentalSplitText(trip.rentals[0]).replace(/<[^>]+>/g, ""),
    "Eugene &amp; Christine $450.00 &middot; Me $450.00");
}

{
  // Percentages, which the form stores in a different column.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 1000, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-jay", cost_percent: 40 },
      { rental_id: "r1", person_id: "p-me" },
    ],
  });
  const m = api.tripMoney(trip);
  check("a percentage share is taken off the top", owed(m),
    { Me: 600, Eugene: 0, Christine: 0, Jay: 400 });
}

// ---- flights: per-seat pricing and points --------------------------------

{
  const { trip, api } = world({
    flights: [{ id: "f1", trip_id: "t1", label: "BWI→DEN", paid_cash: 250,
                passengers: 3, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { flight_id: "f1", person_id: "p-eug", cost: 250 },
      { flight_id: "f1", person_id: "p-chr", cost: 250 },
    ],
  });
  const m = api.tripMoney(trip);
  check("three seats at $250 is a $750 booking", m.total, 750);
  check("a seat each, and the third stays with the payer", owed(m),
    { Me: 250, Eugene: 250, Christine: 250, Jay: 0 });
  check("one ticket is the per-person default", api.flightTicketCost(trip.flights[0]), 250);
}

{
  const { trip, api } = world({
    flights: [{ id: "f1", trip_id: "t1", label: "Award seats", paid_points: 25000,
                passengers: 2, paid_by: "p-me", status: "booked" }],
    booking_people: [{ flight_id: "f1", person_id: "p-jay" }],
  });
  const m = api.tripMoney(trip);
  check("points with no rate count as nothing", m.total, 0);
  check("and the summary says which booking", m.unpriced, ["Award seats"]);

  trip.flights[0].points_cents = 1.5;
  const m2 = api.tripMoney(trip);
  check("a rate turns points into money", m2.total, 750);
  check("no warning once priced", m2.unpriced, []);
  check("Jay takes the unclaimed half, the payer the rest", owed(m2),
    { Me: 0, Eugene: 0, Christine: 0, Jay: 750 });
}

// ---- watching items are not debts -----------------------------------------

{
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Maybe",
                paid_cash: 500, paid_by: "p-me", status: "watching" }],
    booking_people: [{ rental_id: "r1", person_id: "p-jay" },
                     { rental_id: "r1", person_id: "p-me" }],
  });
  const m = api.tripMoney(trip);
  check("a watching item is left out of the settlement", m.total, 0);
  check("nobody owes anything for it", owed(m),
    { Me: 0, Eugene: 0, Christine: 0, Jay: 0 });
  // The planner still needs a figure for it, settled on its own.
  check("but the planner can still price your share of it",
    api.rentalOurPortion(trip.rentals[0]), 250);
}

// ---- lodging rooms, as stored -------------------------------------------

{
  // A cabin with two bedrooms and a couch, the way the rows come back.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug", room: "Main" },
      { rental_id: "r1", person_id: "p-chr", room: "Main" },
      { rental_id: "r1", person_id: "p-me",  room: "Bunk" },
      { rental_id: "r1", person_id: "p-jay", is_couch: true },
    ],
  });
  const m = api.tripMoney(trip);
  check("two bedrooms split the cabin, the couch pays nothing", owed(m),
    { Me: 450, Eugene: 225, Christine: 225, Jay: 0 });
  check("the couch is named as such",
    m.detail.get("p-jay").map(d => d.reason.why), ["couch"]);
  check("and the bedrooms say they're room shares",
    m.detail.get("p-eug").map(d => d.reason.why), ["room"]);
  check("your own share follows the rooms", api.rentalOurPortion(trip.rentals[0]), 450);
}

{
  // Sharing a room must not cost double. Same cabin, same four people, but
  // everyone in their own room.
  const rooms = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug", room: "Main" },
      { rental_id: "r1", person_id: "p-chr", room: "Main" },
      { rental_id: "r1", person_id: "p-me",  room: "Bunk" },
    ],
  });
  const heads = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug" },
      { rental_id: "r1", person_id: "p-chr" },
      { rental_id: "r1", person_id: "p-me" },
    ],
  });
  check("by room, the couple pay for one room between them",
    owed(rooms.api.tripMoney(rooms.trip))["Eugene"], 225);
  check("by head, they'd each pay a third",
    owed(heads.api.tripMoney(heads.trip))["Eugene"], 300);
}

{
  // Rooms on a booking with no shares at all behave as before.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
  });
  check("no shares, no rooms — the whole bill is yours", owed(api.tripMoney(trip)),
    { Me: 900, Eugene: 0, Christine: 0, Jay: 0 });
}

{
  // One person covering a room, as the rows come back.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug", room: "Main", covers_room: true },
      { rental_id: "r1", person_id: "p-chr", room: "Main" },
      { rental_id: "r1", person_id: "p-me",  room: "Bunk" },
    ],
  });
  const m = api.tripMoney(trip);
  check("Eugene covers the room Christine is in", owed(m),
    { Me: 450, Eugene: 450, Christine: 0, Jay: 0 });
  check("and Christine's zero says why",
    m.detail.get("p-chr").map(d => [d.owes, d.reason.why, d.reason.room]),
    [[0, "sharing", "Main"]]);
  const card = api.rentalSplitText(trip.rentals[0]);
  check("the card groups by room like the summary does",
    card.replace(/<[^>]+>/g, ""), "Main Eugene $450.00, Christine sharing &middot; Bunk Me $450.00");
}

// ---- percentages written as fractions ------------------------------------
// A fraction in a percent box is a proportion of the booking — "1/6" is a
// sixth of it, not six hundredths of a percent. Nobody writes it meaning the
// latter, and reading it that way would be wrong by a factor of 600.

{
  const { api } = world();
  const p = api.parsePercent;
  check("a fifth", p("1/5"), 20);
  check("three quarters", p("3/4"), 75);
  check("spaces don't matter", p("1 / 4"), 25);
  check("a plain number is already a percentage", p("20"), 20);
  check("decimals survive", p("16.67"), 16.67);
  check("a sixth, to full precision", Math.round(p("1/6") * 1e6) / 1e6, 16.666667);
  // Anything else is a blank rather than a guess at a number.
  for (const bad of ["", "abc", "1/0", "-5", "1/5/6", "/5", "5/"])
    check(`"${bad}" is not a share`, p(bad), null);
}

{
  // A sixth of a booking that doesn't divide by six: the figure still has to
  // be exact to the cent.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 1000, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-jay", cost_percent: 100 / 6,
        cost_percent_text: "1/6" },
      { rental_id: "r1", person_id: "p-me" },
    ],
  });
  const m = api.tripMoney(trip);
  check("a sixth of $1000 is $166.67", owed(m)["Jay"], 166.67);
  check("and the rest is exactly the remainder", owed(m)["Me"], 833.33);
  check("which together is the whole booking",
    Math.round((owed(m)["Jay"] + owed(m)["Me"]) * 100), 100000);
}

// ---- the breakdown behind a figure ---------------------------------------
// "You owe $212.80" is a claim. The only useful answer to doubting it is the
// list it came from, so every figure carries one.

{
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    flights: [{ id: "f1", trip_id: "t1", label: "Seats", paid_cash: 200,
                passengers: 3, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug", room: "Main" },
      { rental_id: "r1", person_id: "p-chr", room: "Main" },
      { rental_id: "r1", person_id: "p-me",  room: "Bunk" },
      { flight_id: "f1", person_id: "p-eug", cost: 200 },
      { flight_id: "f1", person_id: "p-chr", is_covered: true, covered_by: "p-eug" },
      { flight_id: "f1", person_id: "p-me",  cost: 200 },
    ],
  });
  const m = api.tripMoney(trip);
  const say = id => (m.detail.get(id) || [])
    .map(d => [d.label, d.owes, api.reasonText(trip, d.reason)]);

  // Flights first, then rentals — the order the settlement reads them in.
  check("Eugene's figure breaks down booking by booking", say("p-eug"),
    [["Seats", 400, "covering Christine as well"],
     ["Cabin", 225, "their share of Main"]]);
  check("Christine's says who covered her", say("p-chr"),
    [["Seats", 0, "covered by Eugene"],
     ["Cabin", 225, "their share of Main"]]);
  check("and yours accounts for the whole of both", say("p-me"),
    [["Seats", 200, "a set share"],
     ["Cabin", 450, "their share of Bunk"]]);
  check("the pieces add up to the figure in the table",
    Math.round(say("p-eug").reduce((n, d) => n + d[1], 0) * 100),
    Math.round(owed(m)["Eugene"] * 100));
}

// ---- payments, as stored --------------------------------------------------

{
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: "p-eug" },
      { rental_id: "r1", person_id: "p-chr" },
      { rental_id: "r1", person_id: "p-me" },
    ],
    trip_payments: [
      { id: "pay1", trip_id: "t1", from_person: "p-eug", to_person: null,
        amount: 300, paid_on: "2026-12-10", note: "venmo" },
    ],
  });
  const m = api.tripMoney(trip);
  const net = Object.fromEntries(m.rows.map(r => [r.name, r.net]));
  check("what Eugene owed is unchanged by having paid it",
    Object.fromEntries(m.rows.map(r => [r.name, r.owes])),
    { Me: 300, Eugene: 300, Christine: 300, Jay: 0 });
  check("Eugene is square, Christine still isn't",
    [net["Eugene"], net["Christine"]], [0, -300]);
  check("and you're owed only what's still outstanding", net["Me"], 300);
  check("the payment is listed for the summary",
    m.payments.map(p => [p.from_person, Number(p.amount), p.paid_on]),
    [["p-eug", 300, "2026-12-10"]]);
}

{
  // Several payments on one trip, listed oldest first.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Cabin",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    trip_payments: [
      { id: "b", trip_id: "t1", from_person: "p-chr", amount: 100, paid_on: "2026-12-20" },
      { id: "a", trip_id: "t1", from_person: "p-eug", amount: 100, paid_on: "2026-12-01" },
    ],
  });
  check("payments read in the order they happened",
    api.tripMoney(trip).payments.map(p => p.id), ["a", "b"]);
}

// ---- damaged data ---------------------------------------------------------

{
  // A share row left pointing at nobody — what repointing the shares at the
  // master people list leaves behind if a roster row was never linked.
  const { trip, api } = world({
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 900, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", person_id: null, group_id: null, cost: 300 },
      { rental_id: "r1", person_id: "p-chr", cost: 300 },
    ],
  });
  const m = api.tripMoney(trip);
  check("the unlinked share isn't silently charged to you", owed(m),
    { Me: 300, Eugene: 0, Christine: 300, Jay: 0 });
  check("it's reported as unassigned", m.unassigned, 300);
  check("naming the booking", m.orphans.map(o => o.label), ["Lodge"]);
}

{
  // Someone on the roster who was never linked to a master person.
  const { trip, api } = world({
    trip_people: [{ person_id: "p-me" }, { person_id: null }],
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 100, paid_by: "p-me", status: "booked" }],
  });
  const m = api.tripMoney(trip);
  check("an unlinked roster entry doesn't invent a row", owed(m), { Me: 100 });
}

// ---- a household member who stayed home ----------------------------------

{
  const { trip, api } = world({
    trip_people: [{ person_id: "p-me" }, { person_id: "p-eug" }],
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 800, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { rental_id: "r1", group_id: "g-ec" },
      { rental_id: "r1", person_id: "p-me" },
    ],
  });
  const m = api.tripMoney(trip);
  check("only the household members on the trip take a share", owed(m),
    { Me: 400, Eugene: 400 });
  check("Christine stayed home and owes nothing",
    m.rows.find(r => r.name === "Christine"), undefined);
}

// ---- the whole point: the figures reconcile -------------------------------

{
  const { trip, api } = world({
    flights: [
      { id: "f1", trip_id: "t1", label: "Out", paid_cash: 199.99, passengers: 3,
        paid_by: "p-me", status: "booked" },
      { id: "f2", trip_id: "t1", label: "Back", paid_points: 30000, points_cents: 1.3,
        passengers: 3, paid_by: "p-jay", status: "booked" },
    ],
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", label: "Lodge",
                paid_cash: 1000.01, paid_by: "p-me", status: "booked" }],
    booking_people: [
      { flight_id: "f1", person_id: "p-eug", cost: 199.99 },
      { flight_id: "f2", person_id: "p-jay" },
      { flight_id: "f2", group_id: "g-ec" },
      { rental_id: "r1", group_id: "g-ec" },
      { rental_id: "r1", person_id: "p-me" },
      { rental_id: "r1", person_id: "p-jay", cost_percent: 10 },
    ],
  });
  const m = api.tripMoney(trip);
  const sumOwed = m.rows.reduce((n, r) => n + r.owes, 0);
  const sumPaid = m.rows.reduce((n, r) => n + r.paid, 0);
  check("every cent is accounted for", Math.round((sumOwed + m.unassigned) * 100),
    Math.round(m.total * 100));
  check("and every cent was paid by someone", Math.round(sumPaid * 100),
    Math.round(m.total * 100));
  check("nothing went unassigned with sound data", m.unassigned, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
