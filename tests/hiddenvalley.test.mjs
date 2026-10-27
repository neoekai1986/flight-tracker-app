// The Hidden Valley rental, as actually stored.
//
// Reported as "$3611 for five bedrooms, but it says 9xx a bedroom". The
// cause was that a covered share was written to the database as cost = 0.
// A stated zero takes someone out of the division entirely, so instead of
// their share being worked out and handed to whoever covers them, it was
// never worked out at all and the remaining rooms absorbed the whole bill.
//
// The rows below are copied from the database, zeroes and all. The point of
// this file is that it uses the shape the form wrote, not the shape the
// model assumed — the existing tests all passed throughout the bug because
// they built rows by hand the correct way.
//
//   node tests/hiddenvalley.test.mjs

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
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  const firstLine = src.slice(start, src.indexOf("\n", start));
  if (!firstLine.trimEnd().endsWith("{")) return firstLine + "\n";
  return src.slice(start, src.indexOf("\n};", start) + 3) + "\n";
}

const names = ["bookingCents", "splitCents", "settleTrip", "selfPerson", "personById",
  "groupById", "tripPeople", "personName", "bookingPeopleFor", "settlementBooking",
  "settlementBookings", "settlementGroups", "settlementFor", "tripMoney", "tripPayments"];

const people = [
  { id: "ekai",  name: "E-Kai", is_self: true },
  { id: "chr",   name: "Chrstine" },
  { id: "eug",   name: "Eugene" },
  { id: "bean",  name: "Bean" },
  { id: "sab",   name: "Sabrina" },
  { id: "tom",   name: "Thomas" },
  { id: "geoff", name: "Geoff" },
  { id: "yuh",   name: "yuhung" },
];

// Exactly as the rows came back: three covered shares each carrying cost 0,
// one couch, four blanks, and a room label that names two bedrooms at once.
const shares = () => [
  { rental_id: "r1", person_id: "bean",  room: "2", cost: 0, is_covered: true },
  { rental_id: "r1", person_id: "chr",   room: "1" },
  { rental_id: "r1", person_id: "ekai",  room: "2" },
  { rental_id: "r1", person_id: "eug",   room: "1", cost: 0, is_covered: true },
  { rental_id: "r1", person_id: "geoff", room: "4 and 5" },
  { rental_id: "r1", person_id: "sab",   room: "3" },
  { rental_id: "r1", person_id: "tom",   room: "3", cost: 0, is_covered: true },
  { rental_id: "r1", person_id: "yuh",   room: null, cost: 0, is_couch: true },
];

function build(booking_people){
  const trip = {
    id: "t1", title: "Hidden Valley",
    trip_people: people.map(p => ({ person_id: p.id })),
    flights: [],
    rentals: [{ id: "r1", trip_id: "t1", kind: "housing", status: "booked",
                label: "Nice Hidden valley Rental", paid_cash: 3611.94, paid_by: "ekai" }],
    booking_people,
  };
  const api = new Function("state", `
    const { people, personGroups, trips } = state;
    ${extractConst("toCents")}${extractConst("fromCents")}
    ${extractConst("SELF")}${extractConst("selfId")}
    ${names.map(extract).join("")}
    return { tripMoney };
  `)({ people, personGroups: [], trips: [trip] });
  return api.tripMoney(trip);
}

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
const owes = m => Object.fromEntries(m.rows.map(r => [r.name, r.owes]));

// ---- as stored ------------------------------------------------------------

{
  const m = build(shares());
  const o = owes(m);

  // Four room labels: "1", "2", "3", and "4 and 5" — which names two
  // bedrooms but is one label, so it takes one share.
  check("the bill divides between the four room labels, not the five bedrooms",
    o["Geoff"], 902.98);
  check("a shared room splits between the two people in it", o["Chrstine"], 451.50);
  check("the couch pays nothing", o["yuhung"], 0);
  check("a covered share is nothing for them to pay", [o["Eugene"], o["Bean"], o["Thomas"]],
    [0, 0, 0]);

  // The bug: before the fix these three were a stated zero, so their share
  // was never worked out and E-Kai was charged only his own.
  check("their share is worked out and handed to whoever covers them",
    o["E-Kai"], 1805.97);

  check("and every cent is still accounted for",
    Math.round(m.rows.reduce((n, r) => n + r.owes, 0) * 100), 361194);
  check("the trip cost what it cost", m.total, 3611.94);
}

// ---- with Geoff's two bedrooms priced as two fifths -----------------------
//
// A person can only hold one row per booking, so "4 and 5" can't be two
// rooms. Two fifths as a percentage says the same thing and leaves the rest
// to divide between the three remaining rooms.

{
  const rows = shares();
  rows.find(r => r.person_id === "geoff").cost_percent = 40;
  rows.find(r => r.person_id === "geoff").cost_percent_text = "2/5";
  const m = build(rows);
  const o = owes(m);

  check("Geoff pays two fifths", o["Geoff"], 1444.78);
  // Each of the three remaining rooms is $722.39. Chrstine and Sabrina each
  // pay half of theirs, the other half being covered — so these are half a
  // bedroom, not a whole one.
  check("the other three rooms come to $722.39 each",
    [o["Chrstine"] * 2, (o["Sabrina"] + 0.01) * 2], [722.40, 722.40]);
  check("and each sharer pays half of their room",
    [o["Chrstine"], o["Sabrina"]], [361.20, 361.19]);
  check("E-Kai carries his own share plus the three he covers", o["E-Kai"], 1444.77);
  check("still exact to the cent",
    Math.round(m.rows.reduce((n, r) => n + r.owes, 0) * 100), 361194);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
