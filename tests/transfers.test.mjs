// Tests for who hands money to whom.
//
// settleTrip() says what each person is up or down overall. That is enough
// while one person pays for everything, and useless the moment two people
// have: "Chrstine owes $674.37" doesn't say whether she owes it to you or to
// Eugene. settlementTransfers() turns the per-booking breakdown into actual
// hand-overs, and this suite is about the two properties that make those
// trustworthy:
//
//   1. They reconcile. What a person hands over, less what they receive, is
//      exactly the net the table shows them. Not approximately — the whole
//      point of settling in cents is that it comes out even.
//   2. They are traceable. Every transfer is made of named bookings, because
//      a figure you can't check is a figure you argue about.
//
//   node tests/transfers.test.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  return src.slice(start, src.indexOf("\n}", start) + 2);
}

function extractConst(name){
  const re = new RegExp(`^const ${name} = .*$`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[0] + "\n";
}

const app = new Function(
  extractConst("toCents") + extractConst("fromCents") +
  extract("bookingCents") + extract("splitCents") + extract("settleTrip") +
  extract("settlementTransfers") +
  "return { settleTrip, settlementTransfers };"
)();

let passed = 0, failed = 0;

// Key order follows whichever pair the code touched first, which is an
// artefact rather than a claim. Sorted, so an assertion reads as a set.
const stable = v => (v && typeof v === "object" && !Array.isArray(v))
  ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)))
  : JSON.stringify(v);

function check(name, got, want){
  if (stable(got) === stable(want)) { passed++; return; }
  failed++;
  console.log(`FAIL  ${name}`);
  console.log(`      got  ${stable(got)}`);
  console.log(`      want ${stable(want)}`);
}

const G = { fam: ["mika", "jordan"] };

function settleCase(input){
  return app.settleTrip(Object.assign({ groupMembers: G, selfId: "me" }, input));
}

// The transfers for a case, as "from>to" => cents, which reads far better in
// an assertion than an array of objects.
function plan(input){
  const r = settleCase(input);
  const out = {};
  for (const t of app.settlementTransfers(r.breakdown, input.payments || [], "me"))
    out[`${t.from}>${t.to}`] = t.cents;
  return out;
}

// The property that makes the plan meaningful: following it leaves everyone
// square. For each person, what they hand over less what they receive must
// equal exactly what the settlement says they're down.
function assertSettles(name, input){
  const r = settleCase(input);
  const transfers = app.settlementTransfers(r.breakdown, input.payments || [], "me");
  const moved = {};
  for (const t of transfers){
    moved[t.from] = (moved[t.from] || 0) + t.cents;
    moved[t.to] = (moved[t.to] || 0) - t.cents;
  }
  const bad = [];
  for (const [id, p] of Object.entries(r.people)){
    // netCents is what they're owed; handing over (moved) should wipe it.
    if ((moved[id] || 0) !== -p.netCents)
      bad.push(`${id}: moves ${moved[id] || 0}c, net ${p.netCents}c`);
  }
  for (const id of Object.keys(moved))
    if (!r.people[id]) bad.push(`${id}: moves money but isn't in the settlement`);
  if (bad.length){
    failed++;
    console.log(`FAIL  ${name} — ${bad.join("; ")}`);
  } else passed++;
}

// ---- one payer: the plan is the net column -------------------------------

{
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ]};
  check("one payer, three ways", plan(input), { "ann>me": 20000, "bob>me": 20000 });
  assertSettles("one payer settles", input);
}

{
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [] },
  ]};
  check("nobody else on it: nothing to hand over", plan(input), {});
  assertSettles("payer-only settles", input);
}

// ---- two payers: the case this exists for --------------------------------

{
  // Eugene paid for the house, you paid for the car. Chrstine is on both.
  const input = { bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 900, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "chrstine" }, { personId: "me" }] },
    { id: "b2", label: "Car", kind: "rental", paidCash: 300, paidBy: "me",
      participants: [{ personId: "eugene" }, { personId: "chrstine" }, { personId: "me" }] },
  ]};
  check("each debt goes to whoever paid that booking", plan(input),
    { "chrstine>eugene": 30000, "chrstine>me": 10000, "me>eugene": 20000 });
  assertSettles("two payers settle", input);
}

{
  // Same two payers, and now the debts between them cancel instead of
  // crossing in the post.
  const input = { bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 900, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
    { id: "b2", label: "Flights", kind: "flight", paidCash: 200, passengers: 2, paidBy: "me",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
  ]};
  check("debts between the same two people net off", plan(input), { "me>eugene": 25000 });
  assertSettles("mutual debts settle", input);
}

{
  // Exactly equal in both directions: nobody hands over anything.
  const input = { bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 400, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
    { id: "b2", label: "Car", kind: "rental", paidCash: 400, paidBy: "me",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
  ]};
  check("equal and opposite: no transfer at all", plan(input), {});
  assertSettles("cancelling debts settle", input);
}

// ---- the screenshot: four people, two payers ------------------------------

{
  // E-Kai laid out $946.11, Eugene $1,077.00, four people on the trip. The
  // table said who was up and who was down; this says who pays whom.
  const input = { bookings: [
    { id: "b1", label: "Lodge", kind: "rental", paidCash: 1077, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "chrstine" },
                     { personId: "yuhung" }] },
    { id: "b2", label: "Flights", kind: "flight", paidCash: 946.11, paidBy: "ekai",
      participants: [{ personId: "ekai" }, { personId: "chrstine" }] },
  ], selfId: "ekai" };
  const r = app.settleTrip(Object.assign({ groupMembers: G }, input));
  const transfers = app.settlementTransfers(r.breakdown, [], "ekai");
  // $946.11 over two seats doesn't halve evenly, so one of them carries the
  // odd cent — 473.05 and 473.06, never 473.055 twice.
  check("four people, two payers",
    Object.fromEntries(transfers.map(t => [`${t.from}>${t.to}`, t.cents])),
    { "chrstine>eugene": 35900, "chrstine>ekai": 47305, "yuhung>eugene": 35900 });
  // Largest first, so the biggest hand-over is the one you read first.
  check("sorted by size", transfers.map(t => t.cents), [47305, 35900, 35900]);
  assertSettles("the four-person case settles", input);
}

// ---- what each transfer is made of ---------------------------------------

{
  const input = { bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 900, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "chrstine" }] },
    { id: "b2", label: "Lift passes", kind: "rental", paidCash: 200, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "chrstine" }] },
  ]};
  const t = app.settlementTransfers(settleCase(input).breakdown, [], "me")[0];
  check("a transfer names the bookings behind it",
    t.items.map(i => [i.label, i.cents]), [["House", 45000], ["Lift passes", 10000]]);
  check("biggest booking first", t.items[0].label, "House");
  check("and they add up to the transfer", t.itemsCents, t.cents);
  check("so it's whole", t.itemsCents === t.cents, true);
}

{
  // Netted against a debt the other way, the surviving bookings no longer
  // account for the whole figure. The flag says so rather than letting a
  // short list look complete.
  const input = { bookings: [
    { id: "b1", label: "House", kind: "rental", paidCash: 900, paidBy: "eugene",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
    { id: "b2", label: "Flights", kind: "flight", paidCash: 200, passengers: 2, paidBy: "me",
      participants: [{ personId: "eugene" }, { personId: "me" }] },
  ]};
  const t = app.settlementTransfers(settleCase(input).breakdown, [], "me")[0];
  check("the netted-off transfer still lists its own side",
    t.items.map(i => i.label), ["House"]);
  check("but doesn't claim to be the whole of it", t.itemsCents === t.cents, false);
}

// ---- payments already made ------------------------------------------------

{
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ], payments: [{ from: "ann", to: "me", cents: 20000 }] };
  check("a settled debt drops off the list", plan(input), { "bob>me": 20000 });
  assertSettles("a paid debt settles", input);
}

{
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ], payments: [{ from: "ann", to: "me", cents: 5000 }] };
  check("a part payment leaves the remainder", plan(input),
    { "ann>me": 15000, "bob>me": 20000 });
  assertSettles("a part payment settles", input);
}

{
  // Overpaid. The balance turns around and the app has to say so, rather
  // than showing a debt of minus something.
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ], payments: [{ from: "ann", to: "me", cents: 25000 }] };
  check("overpaying turns the debt around", plan(input),
    { "bob>me": 20000, "me>ann": 5000 });
  assertSettles("an overpayment settles", input);
}

{
  // A payment with no recipient means it was paid to you.
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ], payments: [{ from: "ann", to: null, cents: 20000 }] };
  check("a payment with no recipient is a payment to you", plan(input),
    { "bob>me": 20000 });
}

{
  // Someone pays someone they never owed. It's still money that moved, and
  // it has to leave the ledger balanced.
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }, { personId: "bob" }] },
  ], payments: [{ from: "ann", to: "bob", cents: 20000 }] };
  check("a payment to the wrong person is still recorded", plan(input),
    { "ann>me": 20000, "bob>me": 20000, "bob>ann": 20000 });
  assertSettles("a misdirected payment settles", input);
}

// ---- households -----------------------------------------------------------

{
  // A household is charged as one subject, but settles member by member —
  // there is no bank account called "the Nguyens".
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { groupId: "fam" }] },
  ]};
  check("a household's share divides between its members", plan(input),
    { "jordan>me": 15000, "mika>me": 15000 });
  assertSettles("a household settles", input);
}

{
  // A member of the household paid. Their own household share is still
  // theirs, so they only collect from the others.
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "mika",
      participants: [{ personId: "me" }, { groupId: "fam" }] },
  ]};
  check("a household member who paid collects from the rest", plan(input),
    { "me>mika": 30000, "jordan>mika": 15000 });
  assertSettles("a paying household member settles", input);
}

// ---- free seats and covered shares ---------------------------------------

{
  // A companion pass costs its passenger nothing, so there's nothing to hand
  // over for it.
  const input = { bookings: [
    { id: "b1", label: "Seats", kind: "flight", paidCash: 150, passengers: 2, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann", companion: true }] },
  ]};
  check("a companion seat creates no debt", plan(input), {});
  assertSettles("a companion seat settles", input);
}

{
  // Covered by the payer: the share is worked out and charged straight back
  // to them, so again nothing moves.
  const input = { bookings: [
    { id: "b1", label: "Seats", kind: "flight", paidCash: 150, passengers: 2, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann", covered: true }] },
  ]};
  check("a share covered by the payer creates no debt", plan(input), {});
  assertSettles("a payer-covered share settles", input);
}

{
  // Covered by a third party, who didn't pay the booking: they owe the payer
  // for it, and the person flying owes nobody.
  const input = { bookings: [
    { id: "b1", label: "Seats", kind: "flight", paidCash: 150, passengers: 3, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "bob" },
                     { personId: "ann", covered: true, coveredBy: "bob" }] },
  ]};
  check("whoever covers a share owes it, not whoever used it", plan(input),
    { "bob>me": 30000 });
  assertSettles("a third-party-covered share settles", input);
}

// ---- degenerate input -----------------------------------------------------

check("nothing booked, nothing to hand over",
  app.settlementTransfers([], [], "me"), []);
check("undefined breakdown is empty, not a crash",
  app.settlementTransfers(undefined, undefined, "me"), []);

{
  // An award ticket with no rate set is worth nothing, so nobody owes for it.
  // It's reported as unpriced elsewhere; here it simply moves no money.
  const input = { bookings: [
    { id: "b1", label: "Award", kind: "flight", paidPoints: 25000, passengers: 2, paidBy: "me",
      participants: [{ personId: "me" }, { personId: "ann" }] },
  ]};
  check("an unpriced award booking moves nothing", plan(input), {});
}

{
  // A share charged to nobody is a damaged row. The money is reported as
  // unassigned by the settlement; the plan must not invent someone to
  // collect it from.
  const input = { bookings: [
    { id: "b1", label: "Cabin", kind: "rental", paidCash: 600, paidBy: "me",
      participants: [{ personId: "me" }, { personId: null, groupId: null }] },
  ]};
  const r = settleCase(input);
  const transfers = app.settlementTransfers(r.breakdown, [], "me");
  check("an orphaned share is nobody's to hand over", transfers, []);
  check("and the settlement still reports it", r.unassignedCents, 30000);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
