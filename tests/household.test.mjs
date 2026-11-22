// Tests for a household having someone who carries its costs, and for the
// share block laid out bedroom by bedroom.
//
// A household already settled as one, but its share was divided between its
// members for their running totals. That isn't how a family pays: one person
// hands the money over and the rest of them are simply there. Naming that
// person puts the share on them whole and leaves the others on the booking
// at nothing — which is also what makes a bedroom answerable from one name.
//
//   node tests/household.test.mjs

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
  const start = src.search(new RegExp(`^const ${name} = `, "m"));
  if (start < 0) throw new Error(`${name} not found in index.html`);
  const head = src.slice(start, src.indexOf("\n", start)).trimEnd();
  if (head.endsWith(";")) return head + "\n";
  if (head.endsWith("{") || head.endsWith("[")){
    const close = head.endsWith("[") ? "\n];" : "\n};";
    return src.slice(start, src.indexOf(close, start) + close.length) + "\n";
  }
  return src.slice(start, src.indexOf(";\n", start) + 2);
}

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

// ---- the arithmetic -------------------------------------------------------

const engine = new Function(
  extractConst("toCents") + extractConst("fromCents") +
  extract("bookingCents") + extract("splitCents") + extract("settleTrip") +
  "return { settleTrip };"
)();

const MEMBERS = { ngs: ["eugene", "chrstine"] };
const settleCase = (input) => engine.settleTrip(
  Object.assign({ groupMembers: MEMBERS, selfId: "me" }, input));
const owes = r => Object.fromEntries(Object.entries(r.people).map(([id, p]) => [id, p.owesCents]));

function assertReconciles(name, r){
  const owed = Object.values(r.people).reduce((n, p) => n + p.owesCents, 0);
  if (owed + r.unassignedCents !== r.totalCents){
    failed++;
    console.log(`FAIL  ${name} — accounted for ${owed + r.unassignedCents}c of ${r.totalCents}c`);
  } else passed++;
}

const stay = (extra) => Object.assign({ bookings: [
  { id: "b1", label: "House", kind: "rental", paidCash: 900, paidBy: "me",
    participants: [{ personId: "me" }, { groupId: "ngs" }] },
]}, extra);

{
  // Nobody named: the old behaviour, which has to stay the default. A
  // household that has never said is not one that has said everyone pays
  // their own way.
  const r = settleCase(stay());
  check("unnamed, a household's share divides between its members", owes(r),
    { me: 45000, eugene: 22500, chrstine: 22500 });
  assertReconciles("the unnamed case reconciles", r);
}

{
  const r = settleCase(stay({ groupHeads: { ngs: "eugene" } }));
  check("named, the whole household's share is theirs", owes(r),
    { me: 45000, eugene: 45000, chrstine: 0 });
  assertReconciles("the named case reconciles", r);
}

{
  // The rest of the household stay on the booking, at nothing, and the zero
  // says why — being on it is the fact that put the charge on the head.
  const r = settleCase(stay({ groupHeads: { ngs: "eugene" } }));
  const reason = r.breakdown[0].perReason.chrstine;
  check("and the others are listed, at nothing", r.breakdown[0].perPerson.chrstine, 0);
  check("with the reason naming who carries it", [reason.why, reason.by], ["household", "eugene"]);
}

{
  // A head who isn't in the household is a stale pointer — somebody moved
  // out. Charging them anyway would be wrong, so it falls back to splitting.
  const r = settleCase(stay({ groupHeads: { ngs: "stranger" } }));
  check("a head who left the household is ignored", owes(r),
    { me: 45000, eugene: 22500, chrstine: 22500 });
  assertReconciles("a stale head reconciles", r);
}

{
  // The head pays for the household, and the household is one room.
  const r = settleCase({ bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 1200, paidBy: "me", bedrooms: 4,
      participants: [{ personId: "me", room: "Bedroom 1" },
                     { groupId: "ngs", room: "Bedroom 2" }] },
  ], groupHeads: { ngs: "eugene" } });
  check("a household in a bedroom pays for one bedroom, through its head", owes(r),
    { me: 90000, eugene: 30000, chrstine: 0 });
  assertReconciles("a household in a bedroom reconciles", r);
}

{
  // Two households, one bedroom each, one empty.
  const r = engine.settleTrip({
    groupMembers: { ngs: ["eugene", "chrstine"], kims: ["yuhung", "sam"] },
    groupHeads: { ngs: "eugene", kims: "yuhung" }, selfId: "me",
    bookings: [{ id: "b1", label: "House", kind: "rental", paidCash: 1200,
      paidBy: "me", bedrooms: 4,
      participants: [{ personId: "me", room: "Bedroom 1" },
                     { groupId: "ngs", room: "Bedroom 2" },
                     { groupId: "kims", room: "Bedroom 3" }] }],
  });
  check("each household's bedroom lands on its head", owes(r),
    { me: 60000, eugene: 30000, chrstine: 0, yuhung: 30000, sam: 0 });
  assertReconciles("two households reconcile", r);
}

{
  // The head pays for the household even when the household is covering the
  // whole room for somebody else in it.
  const r = settleCase({ bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 1200, paidBy: "me", bedrooms: 2,
      participants: [{ groupId: "ngs", room: "Bedroom 1", coversRoom: true },
                     { personId: "me", room: "Bedroom 1" },
                     { personId: "kid", room: "Bedroom 2" }] },
  ], groupHeads: { ngs: "eugene" } });
  check("a household covering a room covers it through its head", owes(r),
    { me: 0, eugene: 60000, chrstine: 0, kid: 60000 });
  assertReconciles("a covering household reconciles", r);
}

// ---- the block laid out bedroom by bedroom -------------------------------

const ui = new Function("state", `
  const { people, personGroups } = state;
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const companionPassAvailable = true, lodgingRoomsAvailable = true;
  const coveredSharesAvailable = true, shareTextAvailable = true;
  const lodgingBedroomsAvailable = true, groupHeadAvailable = true;
  ${extractConst("fmtCash")}
  ${extractConst("toCents")}${extractConst("fromCents")}
  ${["bookingCents", "bedroomCost", "bedroomOptions", "roomFieldHTML", "personById",
     "groupById", "tripPeople", "bookingSubjects", "shareValue", "flightTicketCost",
     "parseShare", "bookingPlacement", "bookingPersonRowHTML",
     "bookingPeopleRowsHTML", "headPickerHTML", "subjectHead", "plannerParties",
     "plannerPlaces", "plannerChipHTML", "roomPlannerHTML"].map(extract).join("")}
  return { bookingPeopleRowsHTML, bookingPlacement, headPickerHTML, bookingSubjects,
           subjectHead, plannerParties, plannerPlaces, roomPlannerHTML };
`);

const people = [
  { id: "p-me",  name: "Me", is_self: true },
  { id: "p-eug", name: "Eugene", group_id: "g-ngs" },
  { id: "p-chr", name: "Chrstine", group_id: "g-ngs" },
  { id: "p-yu",  name: "yuhung" },
];
const personGroups = [{ id: "g-ngs", name: "The Ngs", head_id: "p-eug" }];
const trip = { id: "t1", trip_people: people.map(p => ({ person_id: p.id })) };
const api = ui({ people, personGroups });

// The group headings in order, which is the layout the whole change is for.
const headings = html => [...html.matchAll(/class="bp-group-name">([^<]*)</g)].map(m => m[1]);

{
  const html = api.bookingPeopleRowsHTML(trip, "er", [
    { group_id: "g-ngs", room: "Bedroom 1" },
    { person_id: "p-me", room: "Bedroom 2" },
    { person_id: "p-yu", room: "Bedroom 2" },
  ], "rental", { bedrooms: 3, paid_cash: 900, currency: "USD" });
  check("a bedroom for every one the place has, in order", headings(html),
    ["Bedroom 1", "Bedroom 2", "Bedroom 3"]);
  check("the one nobody took says whose problem it is",
    /Bedroom 3[\s\S]*?Nobody in it/.test(html), true);
  check("each bedroom carries what it costs", /\$300\.00/.test(html), true);
  check("and a shared one says what that is each", /\$150\.00 each/.test(html), true);
}

{
  // The household is one entry, not two people — picking it puts the whole
  // family in that room.
  const html = api.bookingPeopleRowsHTML(trip, "er", [{ group_id: "g-ngs", room: "Bedroom 1" }],
    "rental", { bedrooms: 2, paid_cash: 900, currency: "USD" });
  const first = html.slice(html.indexOf("Bedroom 1"), html.indexOf("Bedroom 2"));
  check("a household is one entry in the room", first.includes("The Ngs"), true);
  check("with who that is underneath", first.includes("Eugene, Chrstine"), true);
}

{
  const html = api.bookingPeopleRowsHTML(trip, "er",
    [{ person_id: "p-me", room: "Bedroom 1" }],
    "rental", { bedrooms: 1, paid_cash: 900, currency: "USD" });
  check("everyone not on the booking is listed as such",
    headings(html), ["Bedroom 1", "Not on this booking"]);
}

{
  const html = api.bookingPeopleRowsHTML(trip, "er",
    [{ person_id: "p-me", is_couch: true }, { person_id: "p-yu", room: "Bedroom 1" }],
    "rental", { bedrooms: 1, paid_cash: 900, currency: "USD" });
  check("the couch is its own place to be", headings(html),
    ["Bedroom 1", "Couch", "Not on this booking"]);
  check("and says it costs nothing", /listed, charged nothing/.test(html), true);
}

{
  // No stated count: the old flat list, unchanged. Existing stays must not
  // be reorganised under their owner's feet.
  const html = api.bookingPeopleRowsHTML(trip, "er",
    [{ person_id: "p-me", room: "Main" }], "rental", { paid_cash: 900 });
  check("no count, no bedrooms: the plain list it always was", headings(html), []);
  check("and no placement picker either", html.includes("data-bp-place"), false);
}

{
  const html = api.bookingPeopleRowsHTML(trip, "nf", [], "flight", { paid_cash: 200 });
  check("a flight is never laid out by bedroom", headings(html), []);
}

// ---- where a row files itself --------------------------------------------

check("not on the booking", api.bookingPlacement(null), "__off__");
check("on the couch", api.bookingPlacement({ is_couch: true }), "__couch__");
check("in a bedroom", api.bookingPlacement({ room: "Bedroom 2" }), "Bedroom 2");
check("on it, nowhere in particular", api.bookingPlacement({ room: null }), "__nobed__");
check("the couch wins over a room left behind",
  api.bookingPlacement({ is_couch: true, room: "Bedroom 2" }), "__couch__");

// ---- the picker for who pays for a household -----------------------------

{
  const html = api.headPickerHTML({ id: "g-ngs", name: "The Ngs", head_id: "p-eug" });
  check("it offers the household's own members, and only those",
    [...html.matchAll(/>([^<]+) pays</g)].map(m => m[1]), ["Eugene", "Chrstine"]);
  check("with the one who does already picked",
    /value="p-eug" selected/.test(html), true);
  check("and splitting still on offer", html.includes("— split between them —"), true);
}

check("a household with nobody in it has nobody to pick",
  api.headPickerHTML({ id: "g-none", name: "Empty" }), "");

// ---- the room planner ----------------------------------------------------
//
// The planner stores nothing of its own. A party is a covered share — drop
// Chrstine onto Eugene and her share is charged to him, which is the same
// sentence as "Eugene is responsible for that room". So these tests are
// about one thing: that the picture it draws and the rows underneath it are
// the same booking.

const keyed = (rows) => new Map(rows.map(b =>
  [b.group_id ? `g:${b.group_id}` : `p:${b.person_id}`, b]));
const subjects = api.bookingSubjects(trip, "rental");
const placesOf = (rows, bookingRow) =>
  api.plannerPlaces(subjects, keyed(rows), bookingRow);
const seating = (places) => Object.fromEntries(places.map(pl =>
  [pl.name, pl.parties.map(p => p.under.length
    ? `${p.sub.name} + ${p.under.map(u => u.name).join(" + ")}` : p.sub.name)]));

const HOUSE = { bedrooms: 3, paid_cash: 900, currency: "USD" };

check("who pays for a person is that person",
  api.subjectHead({ key: "p:p-yu", personId: "p-yu", name: "yuhung" }), "p-yu");
check("and for a household, the one it named",
  api.subjectHead({ key: "g:g-ngs", groupId: "g-ngs", name: "The Ngs" }), "p-eug");

{
  const places = placesOf([
    { person_id: "p-me", room: "Bedroom 1" },
    { group_id: "g-ngs", room: "Bedroom 2" },
  ], HOUSE);
  check("every bedroom is a place, then the couch, then the tray",
    places.map(pl => pl.name),
    ["Bedroom 1", "Bedroom 2", "Bedroom 3", "Couch", "Not in the house"]);
  check("people sit where their row says", seating(places),
    { "Bedroom 1": ["Me"], "Bedroom 2": ["The Ngs"], "Bedroom 3": [],
      "Couch": [], "Not in the house": ["yuhung"] });
  check("an empty bedroom still costs what it costs", places[2].cost, 300);
  check("and one party in a room isn't split", places[0].each, null);
}

{
  // Dropped onto somebody: a covered share, which is what the planner draws
  // as one chip inside another.
  const places = placesOf([
    { person_id: "p-me", room: "Bedroom 1" },
    { person_id: "p-yu", room: "Bedroom 1", is_covered: true, covered_by: "p-me" },
  ], HOUSE);
  check("a covered share rides with whoever covers it", seating(places),
    { "Bedroom 1": ["Me + yuhung"], "Bedroom 2": [], "Bedroom 3": [],
      "Couch": [], "Not in the house": ["The Ngs"] });
  check("a party is one party in the room, not two", places[0].each, null);
}

{
  // Two parties in one bedroom do split it, and the room says so.
  const places = placesOf([
    { person_id: "p-me", room: "Bedroom 1" },
    { person_id: "p-yu", room: "Bedroom 1" },
  ], HOUSE);
  check("two parties in one room split it", places[0].each, 150);
}

{
  // Covered by someone not on this trip is a share arrangement, not a
  // party — it has to stay a chip of its own rather than vanishing into
  // somebody who isn't there.
  const places = placesOf([
    { person_id: "p-me", room: "Bedroom 1" },
    { person_id: "p-yu", room: "Bedroom 2", is_covered: true, covered_by: "p-nobody" },
  ], HOUSE);
  check("covered by a stranger is still their own chip", seating(places)["Bedroom 2"],
    ["yuhung"]);
}

{
  // Covered by themselves would otherwise nest a chip inside itself.
  const places = placesOf([
    { person_id: "p-me", room: "Bedroom 1", is_covered: true, covered_by: "p-me" },
  ], HOUSE);
  check("covered by themselves doesn't nest", seating(places)["Bedroom 1"], ["Me"]);
}

{
  // A household is one chip, and somebody can join it — the head named on
  // the household is who their share goes to.
  const places = placesOf([
    { group_id: "g-ngs", room: "Bedroom 1" },
    { person_id: "p-yu", room: "Bedroom 1", is_covered: true, covered_by: "p-eug" },
  ], HOUSE);
  check("joining a household means joining whoever pays for it",
    seating(places)["Bedroom 1"], ["The Ngs + yuhung"]);
}

{
  const places = placesOf([{ person_id: "p-me", is_couch: true }], HOUSE);
  check("the couch is a place to be", seating(places)["Couch"], ["Me"]);
  check("and it costs nothing", places.find(pl => pl.kind === "couch").cost, null);
}

{
  // Nobody placed: everyone is in the tray, which is off the booking. A
  // person on a stay with no room of any kind would be charged for a room
  // of their own, so "not placed" has to mean "not on it".
  const places = placesOf([], HOUSE);
  // Households first, then whoever isn't in one — the order bookingSubjects
  // offers them in, so the tray reads the same as the list underneath.
  check("nobody placed, everybody in the tray", seating(places)["Not in the house"],
    ["The Ngs", "Me", "yuhung"]);
  check("and no bedroom claims anyone",
    places.filter(pl => pl.kind === "bedroom").every(pl => !pl.parties.length), true);
}

{
  // A row with a room the house no longer has — the count was turned down.
  // The room stays on the list rather than the person silently moving.
  const places = placesOf([{ person_id: "p-me", room: "Loft" }],
    { bedrooms: 1, paid_cash: 900, currency: "USD" });
  check("a room from before the count stays a room",
    places.map(pl => pl.name), ["Bedroom 1", "Loft", "Couch", "Not in the house"]);
  check("with whoever is in it still in it", seating(places)["Loft"], ["Me"]);
}

{
  const html = api.roomPlannerHTML(trip, "er", [
    { person_id: "p-me", room: "Bedroom 1" },
    { person_id: "p-yu", room: "Bedroom 1", is_covered: true, covered_by: "p-me" },
  ], HOUSE);
  check("every chip can be picked up",
    [...html.matchAll(/data-bp-chip="([^"]+)"/g)].map(m => m[1]).sort(),
    ["g:g-ngs", "p:p-me", "p:p-yu"]);
  check("every place can be dropped into",
    [...html.matchAll(/data-bp-place-box="([^"]+)"/g)].map(m => m[1]),
    ["Bedroom 1", "Bedroom 2", "Bedroom 3", "__couch__", "__off__"]);
  check("a head says how many it's paying for", /pays for 2/.test(html), true);
  check("an empty bedroom says whose it is", /Nobody — on whoever booked/.test(html), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
