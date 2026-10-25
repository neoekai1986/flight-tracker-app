// Tests for the trip settlement maths.
//
// The app is a single HTML file, so this pulls settleTrip() out of it and
// exercises it as the pure function it is. Everything it needs arrives as
// plain data — no DOM, no database — which is the whole reason it was
// separated out.
//
//   node tests/settlement.test.mjs
//
// Money is in integer cents throughout. Floating-point dollars were the
// reason totals drifted: a three-way split of $640 gives 213.333…, and three
// of those rounded for display sum to $639.99, not $640. Every figure here is
// checked against an exact cent total.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  // Functions are written at one level of indentation inside the module, so
  // the closing brace is the first "\n}" at column zero after the start.
  const end = src.indexOf("\n}", start) + 2;
  return src.slice(start, end);
}

// The two cent helpers are arrow consts rather than declarations, so they're
// pulled in by name instead of by the function extractor.
function extractConst(name){
  const re = new RegExp(`^const ${name} = .*$`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[0] + "\n";
}

const settle = new Function(
  extractConst("toCents") + extractConst("fromCents") +
  extract("bookingCents") + extract("splitCents") + extract("settleTrip") +
  "return { bookingCents, splitCents, settleTrip };"
)();

let passed = 0, failed = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-9;

// Key order is an artefact of which person the code happened to touch first,
// not something worth asserting.
const stable = v => (v && typeof v === "object" && !Array.isArray(v))
  ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : 1)))
  : JSON.stringify(v);

function check(name, got, want){
  const ok = stable(got) === stable(want);
  if (ok) { passed++; }
  else {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      got  ${stable(got)}`);
    console.log(`      want ${stable(want)}`);
  }
}

// Balances as a plain {name: owedCents} map, for readable assertions.
function owes(result){
  const out = {};
  for (const [id, v] of Object.entries(result.people)) out[id] = v.owesCents;
  return out;
}

// The invariant that actually matters: every cent the trip cost is accounted
// for, either against a person or explicitly as unassigned. Exactly — not
// approximately. Anything the code can't attribute has to show up in
// unassignedCents rather than evaporating.
function assertReconciles(name, result){
  const owed = Object.values(result.people).reduce((n, p) => n + p.owesCents, 0);
  const seen = owed + result.unassignedCents;
  if (seen !== result.totalCents){
    failed++;
    console.log(`FAIL  ${name} — accounted for ${seen}c but the trip cost ${result.totalCents}c`);
  } else passed++;
}

const G = { fam: ["mika", "jordan"] };

// ---- what a booking costs -------------------------------------------------

check("cash only",
  settle.bookingCents({ kind: "flight", paidCash: 150, passengers: 3 }), 45000);

check("points with a rate convert",
  settle.bookingCents({ kind: "flight", paidPoints: 20000, passengers: 2, pointsCents: 1.5 }), 60000);

check("points with no rate are worth nothing",
  settle.bookingCents({ kind: "flight", paidPoints: 22000, passengers: 1 }), 0);

check("cash and points together",
  settle.bookingCents({ kind: "flight", paidCash: 50, paidPoints: 10000, passengers: 1, pointsCents: 1.2 }), 17000);

check("rental ignores passengers",
  settle.bookingCents({ kind: "rental", paidCash: 640, passengers: 9 }), 64000);

check("a half-cent fare rounds to the nearest cent",
  settle.bookingCents({ kind: "flight", paidCash: 10.005, passengers: 1 }), 1001);

// ---- dividing a total evenly ----------------------------------------------

check("even split that divides cleanly", settle.splitCents(60000, 3), [20000, 20000, 20000]);
check("remainder cents are handed out, not dropped", settle.splitCents(64000, 3), [21334, 21333, 21333]);
check("one subject takes it all", settle.splitCents(12345, 1), [12345]);
check("nothing to split", settle.splitCents(0, 3), [0, 0, 0]);

// ---- settlement -----------------------------------------------------------

const one = (over) => settleCase({
  bookings: [Object.assign({ id: "b1", label: "Stay", kind: "rental", paidCash: 640, paidBy: "me" }, over)],
});
function settleCase(input){
  return settle.settleTrip(Object.assign({ groupMembers: G, selfId: "me" }, input));
}

{
  const r = one({ participants: [] });
  check("nobody on it: the payer owes the lot", owes(r), { me: 64000 });
  assertReconciles("payer-only reconciles", r);
}

{
  const r = one({ participants: [{ personId: "me" }, { personId: "alice" }, { personId: "bob" }] });
  check("three blank shares divide the total", owes(r),
    { me: 21334, alice: 21333, bob: 21333 });
  assertReconciles("blank three-way reconciles", r);
}

{
  const r = one({ participants: [
    { personId: "alice", amount: 200 },
    { personId: "bob" },
    { personId: "me" },
  ]});
  check("a fixed amount is taken first, the rest splits", owes(r),
    { alice: 20000, bob: 22000, me: 22000 });
  assertReconciles("fixed plus blank reconciles", r);
}

{
  const r = one({ participants: [
    { personId: "alice", percent: 33 },
    { personId: "bob", amount: 200 },
    { personId: "me" },
  ]});
  check("percent, amount and blank together", owes(r),
    { alice: 21120, bob: 20000, me: 22880 });
  assertReconciles("mixed kinds reconcile", r);
}

{
  const r = one({ participants: [
    { personId: "alice", amount: 400 },
    { personId: "bob", amount: 400 },
  ]});
  // The payer is listed because they laid money out, even though the stated
  // shares leave them owing nothing.
  check("over-allocated: stated shares stand", owes(r), { alice: 40000, bob: 40000, me: 0 });
  check("over-allocation is reported", r.warnings.map(w => w.kind), ["over"]);
}

{
  const r = one({ participants: [{ groupId: "fam" }, { personId: "me" }] });
  check("a household is one subject, then divides", owes(r),
    { mika: 16000, jordan: 16000, me: 32000 });
  assertReconciles("household split reconciles", r);
}

{
  const r = one({ participants: [{ groupId: "fam", amount: 300 }, { personId: "me" }] });
  check("a household's fixed share divides between its members", owes(r),
    { mika: 15000, jordan: 15000, me: 34000 });
  assertReconciles("household fixed share reconciles", r);
}

{
  const r = settleCase({ bookings: [
    { id: "f1", label: "Award seat", kind: "flight", paidPoints: 22000, passengers: 1, paidBy: "me",
      participants: [{ personId: "alice" }, { personId: "me" }] },
  ]});
  check("points with no rate: nothing to divide", owes(r), { alice: 0, me: 0 });
  check("and it says why", r.warnings.map(w => w.kind), ["unpriced"]);
}

{
  const r = settleCase({ bookings: [
    { id: "f1", label: "Award seat", kind: "flight", paidPoints: 22000, passengers: 1,
      pointsCents: 1.4, paidBy: "me",
      participants: [{ personId: "alice" }, { personId: "me" }] },
  ]});
  check("points with a rate divide like cash", owes(r), { alice: 15400, me: 15400 });
  check("no warning once priced", r.warnings.length, 0);
  assertReconciles("priced points reconcile", r);
}

{
  const r = settleCase({ bookings: [
    { id: "b1", label: "Stay", kind: "rental", paidCash: 640, paidBy: "me",
      participants: [{ personId: "alice" }, { personId: "me" }] },
    { id: "b2", label: "Seats", kind: "flight", paidCash: 150, passengers: 3, paidBy: "alice",
      participants: [{ personId: "alice" }, { personId: "bob" }, { personId: "me" }] },
  ]});
  check("two bookings, two payers — what each owes", owes(r),
    { alice: 47000, me: 47000, bob: 15000 });
  check("and what each laid out",
    Object.fromEntries(Object.entries(r.people).map(([k, v]) => [k, v.paidCents])),
    { alice: 45000, me: 64000, bob: 0 });
  check("net position", Object.fromEntries(Object.entries(r.people).map(([k, v]) => [k, v.netCents])),
    { alice: -2000, me: 17000, bob: -15000 });
  assertReconciles("multi-booking reconciles", r);
}

{
  // The invariant under awkward numbers: a penny must not go missing.
  const r = settleCase({ bookings: [
    { id: "b1", label: "Odd", kind: "rental", paidCash: 100.01, paidBy: "me",
      participants: [{ personId: "a" }, { personId: "b" }, { personId: "c" }, { personId: "d" },
                     { personId: "e" }, { personId: "f" }, { personId: "g" }] },
  ]});
  assertReconciles("seven-way split of $100.01 reconciles", r);
}

{
  const r = settleCase({ bookings: [] });
  check("no bookings at all", owes(r), {});
  check("nothing to total", r.totalCents, 0);
}

// ---- companion seats ------------------------------------------------------
// A seat flown on a companion pass costs its passenger nothing. That is
// arithmetically a stated share of zero, but it is reported as its own thing,
// because "$0.00" and "didn't cost anything, and here's why" are different
// claims — and the first one looks exactly like a share someone forgot.

{
  const r = one({ participants: [
    { personId: "alice", companion: true },
    { personId: "bob" },
    { personId: "me" },
  ]});
  check("a companion seat costs its passenger nothing", owes(r),
    { alice: 0, bob: 32000, me: 32000 });
  check("and claims none of the total, so the rest still divides in two",
    r.breakdown[0].lines.filter(l => l.why === "even").length, 2);
  check("the line says why it's zero",
    r.breakdown[0].lines.map(l => l.why), ["companion", "even", "even"]);
  assertReconciles("a companion seat reconciles", r);
}

{
  // The distinction that matters: a companion is not a blank. A blank would
  // take a third of the booking.
  const blank = one({ participants: [
    { personId: "alice" }, { personId: "bob" }, { personId: "me" },
  ]});
  const pass = one({ participants: [
    { personId: "alice", companion: true }, { personId: "bob" }, { personId: "me" },
  ]});
  check("a blank share is not the same as a pass",
    [owes(blank).alice, owes(pass).alice], [21334, 0]);
}

{
  // A companion seat on a booking nobody else is on leaves the whole fare
  // with the payer rather than losing it.
  const r = one({ participants: [{ personId: "alice", companion: true }] });
  check("a lone companion leaves the fare with the payer", owes(r),
    { alice: 0, me: 64000 });
  assertReconciles("lone companion reconciles", r);
}

// ---- damaged data ---------------------------------------------------------
// A share row has to point at a person or a household. When it points at
// neither — which repointing the shares at the master people list can leave
// behind — the money is reported as unassigned rather than charged to nobody
// and quietly lost. Losing it is how a ledger comes to disagree with itself.

{
  const r = one({ participants: [
    { personId: "alice", amount: 200 },
    { amount: 100 },                      // linked to no one
    { personId: "me" },
  ]});
  check("an unlinked share is not charged to anyone", owes(r),
    { alice: 20000, me: 34000 });
  check("it is reported as unassigned", r.unassignedCents, 10000);
  check("and named", r.warnings.map(w => [w.kind, w.byCents]), [["orphan", 10000]]);
  assertReconciles("unassigned money still reconciles", r);
}

{
  const r = one({ participants: [{ groupId: "ghosts" }, { personId: "me" }] });
  check("a household with nobody in it can't be charged", owes(r), { me: 32000 });
  check("its half is unassigned, not absorbed", r.unassignedCents, 32000);
  assertReconciles("empty household still reconciles", r);
}

// ---- per-booking shares ---------------------------------------------------
// The cards show your share of one booking; the trip table shows your share
// overall. Both read these, so they cannot disagree.

{
  const r = one({ participants: [{ groupId: "fam" }, { personId: "me" }] });
  check("a household's members each get a per-booking figure",
    r.breakdown[0].perPerson, { jordan: 16000, me: 32000, mika: 16000 });
}

{
  const r = one({ participants: [] });
  check("the payer's unclaimed remainder lands in the per-booking figures",
    r.breakdown[0].perPerson, { me: 64000 });
}

{
  const r = settleCase({ bookings: [
    { id: "b1", label: "Stay", kind: "rental", paidCash: 640, paidBy: "me",
      participants: [{ personId: "alice", amount: 200 }, { personId: "me" }] },
    { id: "b2", label: "Seats", kind: "flight", paidCash: 150, passengers: 2, paidBy: "me",
      participants: [{ personId: "alice" }, { personId: "me" }] },
  ]});
  check("per-booking figures are per booking, not cumulative",
    r.breakdown.map(b => b.perPerson),
    [{ alice: 20000, me: 44000 }, { alice: 15000, me: 15000 }]);
  // And they must reconcile with the trip-wide totals, booking by booking.
  const summed = {};
  for (const b of r.breakdown)
    for (const [id, c] of Object.entries(b.perPerson)) summed[id] = (summed[id] || 0) + c;
  check("per-booking figures sum to what each person owes", summed, owes(r));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
