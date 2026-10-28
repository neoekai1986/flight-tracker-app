// Tests for reading share rows off the form.
//
// This is the layer that kept losing people's input: a "1/5" typed into a
// box and silently stored as nothing. The settlement was tested, the adapter
// was tested, and the step between the form and the database was not — so a
// share could vanish between the two with every suite still green.
//
// readBookingPeople() only ever asks its container for elements by
// attribute, so a small stand-in for the DOM is enough to drive it.
//
//   node tests/form.test.mjs

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

const read = new Function(
  extract("parseShare") + extract("readBookingPeople") +
  "return { parseShare, readBookingPeople };"
)();

// A stand-in container. Each person is one entry; the selectors the function
// builds are matched back to it by attribute name and key.
function container(prefix, people){
  const byKey = new Map(people.map(p => [p.key, p]));
  const field = (key, what) => {
    const p = byKey.get(key);
    if (!p) return null;
    const v = p[what];
    return v === undefined ? null : { value: v };
  };
  return {
    querySelectorAll(sel){
      if (!sel.includes(`-bp-on]`)) return [];
      return people.map(p => ({
        checked: p.checked !== false,
        getAttribute: () => p.key,
      }));
    },
    querySelector(sel){
      const key = (sel.match(/="([^"]+)"/) || [])[1];
      if (sel.includes(".bp-who span")) {
        const p = byKey.get(key);
        return p ? { textContent: p.name } : null;
      }
      if (sel.includes("-bp-val=")) return field(key, "typed");
      if (sel.includes("-bp-unit=")) return field(key, "unit") || { value: "auto" };
      if (sel.includes("-bp-ref=")) return field(key, "ref") || { value: "" };
      if (sel.includes("-bp-by=")) return field(key, "by") || { value: "" };
      if (sel.includes("-bp-room=")) return field(key, "room") || { value: "" };
      return null;
    },
  };
}

const run = (people, bad = []) =>
  read.readBookingPeople(container("t", people), "t", bad);

let passed = 0, failed = 0;
const stable = v => JSON.stringify(v);
function check(name, got, want){
  if (stable(got) === stable(want)) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      got  ${stable(got)}`);
    console.log(`      want ${stable(want)}`);
  }
}
const money = r => [r.cost, r.costPercent, r.costPercentText];

// ---- what reaches the database -------------------------------------------

{
  const [r] = run([{ key: "p:1", name: "Chrstine", typed: "1/5", room: "1" }]);
  check("a fifth is stored as twenty percent", money(r), [null, 20, "1/5"]);
  check("and keeps its room", r.room, "1");
}

{
  const [r] = run([{ key: "p:1", name: "Geoff", typed: "2/5" }]);
  check("two fifths is forty percent", money(r), [null, 40, "2/5"]);
}

{
  const [r] = run([{ key: "p:1", name: "Alice", typed: "150" }]);
  check("a number is money", money(r), [150, null, null]);
}

{
  const [r] = run([{ key: "p:1", name: "Alice", typed: "20%" }]);
  check("a percentage is a percentage", money(r), [null, 20, "20%"]);
}

{
  const [r] = run([{ key: "p:1", name: "Alice", typed: "" }]);
  check("an empty box is a blank share", money(r), [null, null, null]);
}

// ---- the units that take their figure from the booking -------------------

{
  const [r] = run([{ key: "p:1", name: "Bean", typed: "150", unit: "couch" }]);
  check("a couch owes nothing, whatever is in the box", money(r), [0, null, null]);
  check("and isn't in a room", r.room, null);
}

{
  const [r] = run([{ key: "p:1", name: "Bean", typed: "150", unit: "companion" }]);
  check("a companion seat owes nothing", money(r), [0, null, null]);
}

{
  // The bug that made a covered share swallow everyone else's: cost must be
  // null, not zero, or the share is never worked out at all.
  const [r] = run([{ key: "p:1", name: "Bean", typed: "150", unit: "covered", room: "2" }]);
  check("a covered share is blank, not zero", money(r), [null, null, null]);
  check("it is marked covered", [r.isCovered, r.coversRoom], [true, false]);
  check("and keeps its room", r.room, "2");
}

{
  const [r] = run([{ key: "p:1", name: "Eugene", typed: "", unit: "wholeroom", room: "1" }]);
  check("whole room is blank too", money(r), [null, null, null]);
  check("and is marked as covering one", r.coversRoom, true);
}

// ---- input that isn't a share --------------------------------------------

{
  const bad = [];
  const rows = run([
    { key: "p:1", name: "Chrstine", typed: "1/5" },
    { key: "p:2", name: "Geoff", typed: "a fifth" },
  ], bad);
  check("the unreadable one is reported", bad, [{ who: "Geoff", typed: "a fifth" }]);
  check("naming the person, so the box can be found", bad[0].who, "Geoff");
  check("and the readable one is still read", money(rows[0]), [null, 20, "1/5"]);
}

// ---- only ticked people are saved ----------------------------------------

{
  const rows = run([
    { key: "p:1", name: "Chrstine", typed: "1/5" },
    { key: "p:2", name: "Geoff", typed: "2/5", checked: false },
  ]);
  check("someone unticked isn't on the booking", rows.length, 1);
}

// ---- households ----------------------------------------------------------

{
  const [r] = run([{ key: "g:fam", name: "The Nguyens", typed: "1/5" }]);
  check("a household row carries a group, not a person",
    [r.personId, r.groupId], [null, "fam"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
