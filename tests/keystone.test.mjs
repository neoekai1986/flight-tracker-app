// The Keystone trip, as actually stored.
//
// This is the case that was reported wrong three times: "Eugene and
// Christine have money due, yet the summary shows they owe 0". The figures
// below are the real rows from the database, so if the arithmetic ever drifts
// again this is the test that catches it.
//
//   node tests/keystone.test.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  const firstLine = src.slice(start, src.indexOf("\n", start));
  if (firstLine.trimEnd().endsWith("}")) return firstLine + "\n";
  return src.slice(start, src.indexOf("\n}", start) + 2) + "\n";
}
function extractConst(name){
  const m = src.match(new RegExp(`^const ${name} = .*$`, "m"));
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[0] + "\n";
}

const names = ["bookingCents", "splitCents", "settleTrip", "selfPerson", "personById",
  "groupById", "tripPeople", "personName", "bookingPeopleFor", "settlementBooking",
  "settlementBookings", "settlementGroups", "settlementFor", "tripMoney"];

const people = [
  { id: "p-ekai", name: "E-Kai", is_self: true },
  { id: "p-eug",  name: "Eugene" },
  { id: "p-chr",  name: "Chrstine" },
  { id: "p-bean", name: "Bean" },
];

// Exactly as the rows read: both legs are award seats for 3 at 1.12c a point,
// paid by E-Kai. Four people are ticked on each.
const trip = {
  id: "t-keystone", title: "Keystone-Ski",
  trip_people: people.map(p => ({ person_id: p.id })),
  flights: [
    { id: "f-out", trip_id: "t-keystone", label: "12/4/26 BWI to DEN - Points",
      status: "booked", paid_cash: null, paid_points: 11000, points_cents: 1.12,
      passengers: 3, paid_by: "p-ekai" },
    { id: "f-back", trip_id: "t-keystone", label: "12/8/26 DEN to BWI - Points",
      status: "booked", paid_cash: null, paid_points: 8000, points_cents: 1.12,
      passengers: 3, paid_by: "p-ekai" },
  ],
  rentals: [],
  booking_people: [
    // Outbound: Bean down for nothing, the other three left blank.
    { flight_id: "f-out", person_id: "p-bean", cost: 0 },
    { flight_id: "f-out", person_id: "p-chr" },
    { flight_id: "f-out", person_id: "p-ekai" },
    { flight_id: "f-out", person_id: "p-eug" },
    // Return: a full ticket against all four — including Bean, who flies on a
    // companion pass and should be down for nothing. That is the error.
    { flight_id: "f-back", person_id: "p-bean", cost: 89.6 },
    { flight_id: "f-back", person_id: "p-chr",  cost: 89.6 },
    { flight_id: "f-back", person_id: "p-ekai", cost: 89.6 },
    { flight_id: "f-back", person_id: "p-eug",  cost: 89.6 },
  ],
};

const api = new Function("state", `
  const { people, personGroups, trips } = state;
  ${extractConst("toCents")}${extractConst("fromCents")}
  ${extractConst("SELF")}${extractConst("selfId")}
  ${names.map(extract).join("")}
  return { tripMoney };
`)({ people, personGroups: [], trips: [trip] });

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

const m = api.tripMoney(trip);
const owed = Object.fromEntries(m.rows.map(r => [r.name, r.owes]));

// 11,000 points x 3 seats at 1.12c = $369.60; 8,000 x 3 = $268.80.
check("the two award legs are worth real money", m.total, 638.40);

// Outbound: Bean is explicitly down for nothing, so the $369.60 divides
// between the three people left blank.
// Return: a full ticket each for four people on a three-seat booking.
check("Eugene owes both legs, not nothing", owed["Eugene"], 212.80);
check("Chrstine owes the same", owed["Chrstine"], 212.80);
check("Bean owes the return leg only", owed["Bean"], 89.60);
check("E-Kai owes a share like everyone else", owed["E-Kai"], 212.80);

check("E-Kai laid out the whole lot", m.rows.find(r => r.name === "E-Kai").paid, 638.40);

// Four full tickets on a three-seat booking is $89.60 more than the flight
// cost. The figures can't reconcile while that's true, and saying so is the
// only honest thing to do with it.
check("the over-allocation is reported", m.over.map(o => [o.label, o.by]),
  [["12/8/26 DEN to BWI - Points", 89.60]]);
check("nothing is unassigned", m.unassigned, 0);
check("no unpriced warning — both legs have a rate", m.unpriced, []);

// ---- the same trip with Bean's companion seat recorded correctly ---------
//
// Bean flies free on a Southwest companion pass, so the three points tickets
// are the whole cost and Bean's share of both legs is nothing. Setting the
// return leg to 0 is the one edit needed; these assert what that produces,
// so the fix can be checked rather than hoped for.

trip.booking_people.find(b => b.flight_id === "f-back" && b.person_id === "p-bean").cost = 0;

const fixed = api.tripMoney(trip);
const fixedOwed = Object.fromEntries(fixed.rows.map(r => [r.name, r.owes]));

check("the flights still cost what they cost", fixed.total, 638.40);
check("a companion seat costs its passenger nothing", fixedOwed["Bean"], 0);
check("Eugene is unchanged", fixedOwed["Eugene"], 212.80);
check("Chrstine is unchanged", fixedOwed["Chrstine"], 212.80);
check("E-Kai is unchanged", fixedOwed["E-Kai"], 212.80);
check("and now the shares reconcile exactly", fixed.over, []);
check("but a bare zero doesn't say Bean flew on a pass",
  fixed.freeFor.has("p-bean"), false);
check("three paying passengers, split three ways",
  Math.round(fixed.rows.reduce((n, r) => n + r.owes, 0) * 100), 63840);

// ---- the same trip with the companion pass recorded as such -------------
//
// Setting the share to zero gets the arithmetic right but still reads as a
// share someone forgot to fill in. Marking both legs as a companion seat
// says why, and the summary shows "companion pass" instead of $0.00.

for (const b of trip.booking_people){
  if (b.person_id === "p-bean"){ b.is_companion = true; b.cost = null; }
}

const marked = api.tripMoney(trip);
const markedOwed = Object.fromEntries(marked.rows.map(r => [r.name, r.owes]));

check("the figures are unchanged by saying why", markedOwed,
  { "Bean": 0, "Chrstine": 212.80, "E-Kai": 212.80, "Eugene": 212.80 });
check("the trip still costs what it costs", marked.total, 638.40);
check("Bean is now named as a companion", marked.freeFor.has("p-bean"), true);
check("nobody else is", [...marked.freeFor.keys()], ["p-bean"]);
check("and it says which kind of free seat",
  [...marked.freeFor.get("p-bean")], ["companion pass"]);
check("and it still reconciles", marked.over, []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
