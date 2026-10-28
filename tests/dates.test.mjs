// Tests for the date on a card.
//
// The weekday is the easy half. The half that has already gone wrong in this
// app is the timezone: a bare ISO date handed to Date.parse is read as UTC,
// so anywhere west of Greenwich it comes back as the day before — which is
// how a payment once got filed on tomorrow's date. The formatter builds the
// date from its parts instead, and the second half of this file proves it by
// running the same assertions from Honolulu and from Kiritimati, the two ends
// of the day.
//
//   node tests/dates.test.mjs

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = fileURLToPath(import.meta.url);
const root = path.dirname(here);
const src = fs.readFileSync(path.join(root, "..", "index.html"), "utf8");

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name}() not found in index.html`);
  return src.slice(start, src.indexOf("\n}", start) + 2) + "\n";
}

const F = new Function(
  extract("fmtShortDate") + extract("fmtShortDateDay") +
  "return { fmtShortDate, fmtShortDateDay };"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  if (got === want){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
}

// The day of the week, in front, for every day of one week.
is("monday", F.fmtShortDateDay("2026-03-23"), "Mon, Mar 23");
is("sunday", F.fmtShortDateDay("2026-03-29"), "Sun, Mar 29");
is("christmas", F.fmtShortDateDay("2026-12-25"), "Fri, Dec 25");
is("new year", F.fmtShortDateDay("2027-01-01"), "Fri, Jan 1");
is("leap-shy february", F.fmtShortDateDay("2026-02-28"), "Sat, Feb 28");
is("leap day", F.fmtShortDateDay("2028-02-29"), "Tue, Feb 29");

// Nothing in, nothing out — a card with no date shows no date, not "Invalid".
is("empty", F.fmtShortDateDay(""), "");
is("null", F.fmtShortDateDay(null), "");
is("undefined", F.fmtShortDateDay(undefined), "");
// Something that isn't a date comes back untouched rather than as a guess.
is("not a date", F.fmtShortDateDay("sometime in March"), "sometime in March");

// The plain form is unchanged — it is still what the price table and the
// summary use, where a weekday on every row would be noise.
is("plain form", F.fmtShortDate("2026-03-23"), "Mar 23");

// The timezone half. The child runs this same file with TZ set; the guard
// below keeps it from recursing.
if (!process.env.CARD_DATE_TZ_CHILD){
  for (const tz of ["Pacific/Honolulu", "Pacific/Kiritimati", "UTC"]){
    try {
      execFileSync(process.execPath, [here], {
        env: { ...process.env, TZ: tz, CARD_DATE_TZ_CHILD: "1" },
        stdio: "pipe"
      });
      passed++;
    } catch (e){
      failed++;
      console.error(`FAIL in ${tz}\n${e.stdout?.toString() || ""}${e.stderr?.toString() || ""}`);
    }
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
