// Tests for splitting a house by its bedrooms.
//
// A lodging cost was already divided by room rather than by head, but the
// divisor was "however many room names somebody happened to type". That
// number moves: add a person to a room and nothing changes, give them a room
// of their own and every other room gets cheaper. What a bedroom costs
// shouldn't depend on who turned up.
//
// Stating the count fixes it. Four bedrooms means each one is a quarter of
// the place, whoever sleeps in it and whether anyone does. The room nobody
// took still costs a quarter, and that lands on whoever booked — visibly,
// not spread over the people who did take one.
//
//   node tests/bedrooms.test.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  const line = src.slice(start, src.indexOf("\n", start));
  if (line.trimEnd().endsWith("}")
      && (line.match(/{/g) || []).length === (line.match(/}/g) || []).length)
    return line + "\n";
  return src.slice(start, src.indexOf("\n}", start) + 2) + "\n";
}

function extractConst(name){
  const re = new RegExp(`^const ${name} = .*$`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[0] + "\n";
}

const app = new Function(
  `const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c =>
     ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));` +
  extractConst("toCents") + extractConst("fromCents") +
  extract("bookingCents") + extract("splitCents") + extract("settleTrip") +
  extract("bedroomOptions") + extract("roomFieldHTML") +
  "return { settleTrip, bedroomOptions, roomFieldHTML };"
)();

let passed = 0, failed = 0;
const stable = v => (v && typeof v === "object" && !Array.isArray(v))
  ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : 1)))
  : JSON.stringify(v);

function check(name, got, want){
  if (stable(got) === stable(want)) { passed++; return; }
  failed++;
  console.log(`FAIL  ${name}`);
  console.log(`      got  ${stable(got)}`);
  console.log(`      want ${stable(want)}`);
}

function settleCase(input){
  return app.settleTrip(Object.assign({ groupMembers: { fam: ["mika", "jordan"] },
                                        selfId: "me" }, input));
}
const owes = r => Object.fromEntries(Object.entries(r.people).map(([id, p]) => [id, p.owesCents]));

// The invariant every one of these has to keep: the trip cost lands on
// somebody, to the cent. A bedroom nobody took is still money, and the one
// thing that must never happen is it quietly leaving the ledger.
function assertReconciles(name, r){
  const owed = Object.values(r.people).reduce((n, p) => n + p.owesCents, 0);
  if (owed + r.unassignedCents !== r.totalCents){
    failed++;
    console.log(`FAIL  ${name} — accounted for ${owed + r.unassignedCents}c of ${r.totalCents}c`);
  } else passed++;
}

// A four-bedroom house at $1,200: each bedroom is $300.
const house = (participants, bedrooms) => ({ bookings: [
  { id: "b1", label: "House", kind: "rental", paidCash: 1200, paidBy: "me",
    bedrooms, participants },
]});

// ---- the point of stating the count --------------------------------------

{
  // Three of the four bedrooms taken. Each costs a quarter, and the one
  // nobody took costs a quarter too — which is the booker's problem.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 3" },
  ], 4));
  check("each bedroom is a quarter, used or not", owes(r),
    { me: 60000, ann: 30000, bob: 30000 });
  check("and the empty one says so",
    r.breakdown[0].lines.filter(l => l.why === "emptyrooms")
      .map(l => [l.subject, l.cents, l.rooms]), [["me", 30000, 1]]);
  assertReconciles("three of four reconciles", r);
}

{
  // Without the count, the same three people divide by three and the house
  // appears to have exactly as many bedrooms as were claimed. This is the
  // behaviour that made a room's cost depend on the turnout.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 3" },
  ], null));
  check("unstated, the rooms in use are all the rooms there are", owes(r),
    { me: 40000, ann: 40000, bob: 40000 });
  assertReconciles("the unstated case reconciles", r);
}

{
  // The whole reason for the field: somebody drops out, and the people left
  // pay what they always paid rather than inheriting the empty room.
  const four = settleCase(house([
    { personId: "me", room: "Bedroom 1" }, { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 3" }, { personId: "cal", room: "Bedroom 4" },
  ], 4));
  const three = settleCase(house([
    { personId: "me", room: "Bedroom 1" }, { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 3" },
  ], 4));
  check("a bedroom costs the same whoever shows up",
    [four.people.ann.owesCents, three.people.ann.owesCents], [30000, 30000]);
  check("and the one who booked carries the empty room",
    [four.people.me.owesCents, three.people.me.owesCents], [30000, 60000]);
}

// ---- sharing a room -------------------------------------------------------

{
  // Two in a room split that room, not the house. This is what the whole
  // room-based split is for.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 2" },
  ], 4));
  check("two in a bedroom halve it, and don't pay twice over", owes(r),
    { me: 90000, ann: 15000, bob: 15000 });
  assertReconciles("a shared bedroom reconciles", r);
}

{
  // A family of three in one room pays for one room.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 2" },
    { personId: "cal", room: "Bedroom 2" },
  ], 4));
  check("three in a bedroom still pay for one bedroom",
    [r.people.ann.owesCents, r.people.bob.owesCents, r.people.cal.owesCents],
    [10000, 10000, 10000]);
  assertReconciles("a family in one room reconciles", r);
}

{
  // An odd figure divides to the cent, not to the rounding.
  const r = settleCase({ bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 1000, paidBy: "me", bedrooms: 3,
      participants: [{ personId: "me", room: "Bedroom 1" },
                     { personId: "ann", room: "Bedroom 2" },
                     { personId: "bob", room: "Bedroom 2" }] },
  ]});
  check("a third of a thousand lands exactly", owes(r),
    { me: 66667, ann: 16667, bob: 16666 });
  assertReconciles("an odd division reconciles", r);
}

// ---- head of household ----------------------------------------------------

{
  // One person takes the whole room. The others are still recorded as being
  // in it — who slept where is the point — they just aren't charged.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2", coversRoom: true },
    { personId: "bob", room: "Bedroom 2" },
    { personId: "cal", room: "Bedroom 2" },
  ], 4));
  check("whoever covers the room pays for all of it", owes(r),
    { me: 90000, ann: 30000, bob: 0, cal: 0 });
  check("and the others are listed in it, at nothing",
    r.breakdown[0].lines.filter(l => l.why === "sharing").map(l => [l.subject, l.cents]),
    [["bob", 0], ["cal", 0]]);
  assertReconciles("a covered room reconciles", r);
}

{
  // Two people covering the same room split it between them — a couple
  // taking their family's room together.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2", coversRoom: true },
    { personId: "bob", room: "Bedroom 2", coversRoom: true },
    { personId: "cal", room: "Bedroom 2" },
  ], 4));
  check("two covering a room split it", owes(r),
    { me: 90000, ann: 15000, bob: 15000, cal: 0 });
  assertReconciles("two coverers reconcile", r);
}

// ---- the couch ------------------------------------------------------------

{
  // On the couch is not in a bedroom, so it takes no bedroom's worth and
  // frees none either — the house still has four rooms.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", couch: true },
  ], 4));
  check("the couch costs nothing and takes no room", owes(r),
    { me: 90000, ann: 30000, bob: 0 });
  assertReconciles("the couch reconciles", r);
}

// ---- someone with no room named ------------------------------------------

{
  // No room named still counts as a room of their own, which is what makes
  // this one code path rather than two. With four bedrooms stated and two
  // people in no particular room, they take two of the four.
  const r = settleCase(house([
    { personId: "me" }, { personId: "ann" },
  ], 4));
  check("no room named is still a room taken", owes(r),
    { me: 90000, ann: 30000 });
  assertReconciles("unnamed rooms reconcile", r);
}

// ---- the count can only ever be raised by the rooms in use ---------------

{
  // Five rooms claimed in a four-bedroom house. Dividing by four and
  // charging five rooms would invent $300 nobody owes, so the rooms in use
  // win and the count is reported as wrong.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" }, { personId: "ann", room: "Bedroom 2" },
    { personId: "bob", room: "Bedroom 3" }, { personId: "cal", room: "Bedroom 4" },
    { personId: "dee", room: "Bedroom 5" },
  ], 4));
  check("more rooms in use than the house has: the rooms win", owes(r),
    { me: 24000, ann: 24000, bob: 24000, cal: 24000, dee: 24000 });
  check("and it's reported rather than silently corrected",
    r.warnings.filter(w => w.kind === "bedrooms").map(w => [w.stated, w.used]),
    [[4, 5]]);
  assertReconciles("too many rooms reconciles", r);
}

{
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" }, { personId: "ann", room: "Bedroom 2" },
  ], 2));
  check("a count that matches raises no complaint",
    r.warnings.filter(w => w.kind === "bedrooms"), []);
}

// ---- stated shares still override ----------------------------------------

{
  // Someone who agreed a flat figure pays that figure, and the bedrooms
  // divide what's left of the house.
  const r = settleCase(house([
    { personId: "me", room: "Bedroom 1" },
    { personId: "ann", amount: 200 },
    { personId: "bob", room: "Bedroom 2" },
  ], 4));
  check("a flat share comes off the top, the rest divides by bedroom", owes(r),
    { me: 75000, ann: 20000, bob: 25000 });
  assertReconciles("a flat share with bedrooms reconciles", r);
}

// ---- nobody in the house --------------------------------------------------

{
  // Bedrooms stated and nobody on the booking: it's all yours, as it always
  // was. The count mustn't conjure a split out of an empty list.
  const r = settleCase(house([], 4));
  check("nobody on it: the whole place is the payer's", owes(r), { me: 120000 });
  assertReconciles("an empty house reconciles", r);
}

// ---- a car has no bedrooms ------------------------------------------------

{
  // bedrooms is only ever set on a place you sleep, but the engine shouldn't
  // depend on the caller for that: zero and nonsense both mean "no count".
  for (const [name, n] of [["zero", 0], ["null", null], ["rubbish", "four"]]){
    const r = settleCase(house([
      { personId: "me", room: "Bedroom 1" }, { personId: "ann", room: "Bedroom 2" },
    ], n));
    check(`${name} bedrooms divides by the rooms in use`, owes(r),
      { me: 60000, ann: 60000 });
  }
}

{
  // A fractional count is rounded rather than producing a fractional room.
  const r = settleCase(house([{ personId: "me", room: "Bedroom 1" }], 3.4));
  check("a fractional count rounds", owes(r), { me: 120000 });
  check("and the empty rooms are whole ones",
    r.breakdown[0].lines.find(l => l.why === "emptyrooms").rooms, 2);
}

// ---- the bedroom list the form offers ------------------------------------

check("a stated count becomes a list to pick from",
  app.bedroomOptions({ bedrooms: 3 }, []), ["Bedroom 1", "Bedroom 2", "Bedroom 3"]);

check("no count, no list — the room stays a free-text box",
  app.bedroomOptions({}, []), []);

check("rooms recorded before the count existed stay on the list",
  app.bedroomOptions({ bedrooms: 2 }, [{ room: "Loft" }, { room: "Bedroom 1" }]),
  ["Bedroom 1", "Bedroom 2", "Loft"]);

check("a room already on the list isn't offered twice",
  app.bedroomOptions({ bedrooms: 2 }, [{ room: "Bedroom 2" }, { room: "Bedroom 2" }]),
  ["Bedroom 1", "Bedroom 2"]);

check("a share row with no room adds nothing",
  app.bedroomOptions({ bedrooms: 1 }, [{ room: null }, { room: "" }]), ["Bedroom 1"]);

{
  const html = app.roomFieldHTML("er", "p:abc", "Bedroom 2", ["Bedroom 1", "Bedroom 2"], false);
  check("the picker is a select", html.trim().startsWith("<select"), true);
  check("with the room they're in already chosen",
    /value="Bedroom 2" selected/.test(html), true);
  check("and a way to be in none of them", html.includes("— no bedroom —"), true);
}

{
  const html = app.roomFieldHTML("er", "p:abc", "", [], false);
  check("with no count it's the typing box it always was",
    html.trim().startsWith("<input"), true);
}

{
  const html = app.roomFieldHTML("er", "p:abc", "Bedroom 1", ["Bedroom 1"], true);
  check("somebody on the couch isn't picking a bedroom", html.includes("disabled"), true);
}

// ---- The count, and where it lives on the form ----
//
// The planner only exists once the place has a stated number of bedrooms, so
// the box that states it is the switch that turns the rooms on. It used to
// sit eight fields up the form, which made the planner look like it had
// vanished rather than like it was waiting for a number. These check that the
// switch is beside the thing it switches, and that a rebuild can't eat it:
// typing in it rebuilds the share block, so it has to be outside the part
// that gets replaced.

function extractWrapped(name){
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  return src.slice(start, src.indexOf(";\n", start) + 2);
}

const formNames = ["bookingCents", "bedroomCost", "bedroomOptions", "roomFieldHTML",
  "personById", "groupById", "tripPeople", "bookingSubjects", "shareValue",
  "flightTicketCost", "parseShare", "bookingPlacement", "bookingPersonRowHTML",
  "bookingPeopleRowsHTML", "headPickerHTML", "subjectHead", "plannerParties",
  "plannerWhere", "plannerPlaces", "plannerChipHTML", "roomPlannerHTML",
  "bookingPeopleFieldsHTML"];

const block = new Function("state", `
  const { people, personGroups } = state;
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const companionPassAvailable = true, lodgingRoomsAvailable = true;
  const coveredSharesAvailable = true, shareTextAvailable = true;
  const lodgingBedroomsAvailable = true, groupHeadAvailable = true;
  const bpContext = {};
  ${extractWrapped("fmtCash")}${extractConst("toCents")}${extractConst("fromCents")}
  ${formNames.map(extract).join("")}
  return bookingPeopleFieldsHTML(state.trip, "er", state.existing, state.kind, state.row);
`);

const roster = [
  { id: "me", name: "Me", is_self: true },
  { id: "kit", name: "Kit" },
];
const shareBlock = (kind, row) => block({
  people: roster, personGroups: [], kind, row,
  trip: { id: "t1", trip_people: roster.map(p => ({ person_id: p.id })) },
  existing: [{ person_id: "kit", room: "Bedroom 1" }],
});

{
  const html = shareBlock("rental", { currency: "USD" });
  check("with no count stated the block still asks for one",
    html.includes("data-er-bedrooms"), true);
  check("and says what saying it does",
    html.includes("this turns into the bedrooms themselves"), true);
  check("there being no rooms to drag anybody into yet",
    html.includes("data-bp-planner"), false);
}

{
  const html = shareBlock("rental", { bedrooms: 4, paid_cash: 1200, currency: "USD" });
  check("a count turns the rooms on", html.includes("data-bp-planner"), true);
  check("and prices each one", html.includes("$300.00 of this booking"), true);
  check("the count is asked for above the rooms, not below them",
    html.indexOf("data-er-bedrooms") < html.indexOf("data-bp-planner"), true);
  // rerenderBookingPeople replaces everything inside [data-bp-people]. The
  // count field is what you are typing in when that happens.
  const host = html.indexOf('data-bp-people="er"');
  check("and outside the part a rebuild replaces",
    html.indexOf("data-er-bedrooms") < host, true);
}

{
  const html = shareBlock("flight", { currency: "USD" });
  check("a flight is not asked how many bedrooms it has",
    html.includes("data-er-bedrooms"), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
