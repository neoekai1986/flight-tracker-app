// Tests for which trips are offered when a flight arrives from the browser.
//
// The "Add flight" bookmarklet comes from another tab and carries no clue
// which trip it's for, so it asks. It used to ask with every trip there had
// ever been, in folder order, which put last year's holidays above the one
// being planned.
//
//   node tests/trippick.test.mjs

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

const tripsByTime = new Function(extract("tripsByTime") + "return tripsByTime;")();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

const TODAY = "2026-10-30";
const trip = (title, start, end) => ({ id: title, title, travel_start: start, travel_end: end });
const names = (list) => list.map(t => t.title);

const all = [
  trip("Keystone", "2026-02-14", "2026-02-21"),   // taken
  trip("Reno", "2027-03-23", "2027-03-29"),       // ahead
  trip("Hidden Valley", "2026-10-28", "2026-11-02"), // running now
  trip("Japan someday", null, null),              // no dates
  trip("Orlando", "2026-06-01", "2026-06-08"),    // taken
  trip("Thanksgiving", "2026-11-25", null),       // ahead, one date
];

{
  const { upcoming, past } = tripsByTime(all, TODAY);
  is("what's ahead", names(upcoming),
     ["Hidden Valley", "Thanksgiving", "Reno", "Japan someday"]);
  is("what's been", names(past), ["Orlando", "Keystone"]);
}

// A trip is past the day after it ends, not the day it does — you can still
// be on it, and a flight home is still a flight to add.
{
  const ending = [trip("today", "2026-10-25", TODAY), trip("yesterday", "2026-10-20", "2026-10-29")];
  const { upcoming, past } = tripsByTime(ending, TODAY);
  is("ends today is still ahead", names(upcoming), ["today"]);
  is("ended yesterday is past", names(past), ["yesterday"]);
}

// A trip with only a start date is judged on it.
{
  const { upcoming, past } = tripsByTime(
    [trip("one way out", "2027-01-05", null), trip("one way gone", "2026-01-05", null)], TODAY);
  is("start only, ahead", names(upcoming), ["one way out"]);
  is("start only, past", names(past), ["one way gone"]);
}

// Nothing dated is a trip being planned, which is the likeliest thing a
// flight found in a search belongs to — so it's offered, just behind the
// trips that have a place in the timeline.
{
  const { upcoming, past } = tripsByTime(
    [trip("Someday B", null, null), trip("Someday A", null, null)], TODAY);
  is("undated are offered", names(upcoming), ["Someday A", "Someday B"]);
  is("and none are past", names(past), []);
}

// Nothing at all.
{
  const { upcoming, past } = tripsByTime([], TODAY);
  is("no trips", [upcoming, past], [[], []]);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
