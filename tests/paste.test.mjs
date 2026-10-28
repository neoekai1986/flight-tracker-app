// Tests for what a pasted search result puts in the add-flight form.
//
// Parsing the result right is only half of it: the date has to reach the
// date box. It didn't, and the box is prefilled with the trip's own travel
// window, so every flight pasted in was quietly filed on the trip's start
// date instead of its own.
//
// wireAutoTitle only ever asks its container for querySelector and
// querySelectorAll, and the fields for value/dataset/addEventListener, so a
// stand-in container is enough to drive the real wiring.
//
//   node tests/paste.test.mjs

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

// fmtCash is an arrow const and only feeds a placeholder here, so it stands
// in rather than being lifted out of the file.
const wireAutoTitle = new Function(
  "const fmtCash = (n) => `$${n}`;\n"
  + extract("parseFlightResultText")
  + extract("parseFlightUrl")
  + extract("flightTitle")
  + extract("fmtTime")
  + extract("fmtShortDateDay")
  + extract("wireAutoTitle")
  + "return wireAutoTitle;"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

// Every field the add-flight form hands wireAutoTitle, by the selector it
// hands it under.
const SEL = {
  url: "url", origin: "origin", dest: "dest", date: "date", time: "time",
  paidCash: "paidCash", paidPoints: "paidPoints", label: "label", leg: "leg",
  returnDate: "returnDate", returnWrap: "returnWrap", returnTime: "returnTime",
  passengers: "passengers", airline: "airline",
  result: "result", resultRead: "resultRead",
  stopsOut: "stopsOut", stopsBack: "stopsBack",
  arrive: "arrive", returnArrive: "returnArrive",
  duration: "duration", returnDuration: "returnDuration",
  pointsCents: "pointsCents",
};

function form(prefill = {}){
  const fields = {};
  for (const key of Object.keys(SEL)){
    fields[key] = {
      value: prefill[key] != null ? prefill[key] : "",
      dataset: {}, style: {}, placeholder: "", textContent: "",
      handlers: {},
      addEventListener(type, fn){ (this.handlers[type] = this.handlers[type] || []).push(fn); },
    };
  }
  const container = {
    querySelector: (sel) => fields[sel] || null,
    querySelectorAll: () => [],
  };
  wireAutoTitle(container, { ...SEL, bpPrefix: "nf" });
  return {
    fields,
    // Typing or pasting into a box, the way the browser reports it.
    type(key, text){
      fields[key].value = text;
      (fields[key].handlers.input || []).forEach(fn => fn());
    },
  };
}

// The flight that found this: pasted into a form whose dates still hold the
// trip's travel window, which is March 1-31 while the flight is the 23rd.
const united = `Mon, Mar 23, 2026
8:35 AM – 1:21 PM
IAD – RNO
United
1 stop  ORD
7h 46m

Sun, Mar 29, 2026
1:42 PM – 1:17 AM
RNO – IAD
United
1 stop  SFO
8h 35m`;

{
  const f = form({ date: "2026-03-01", returnDate: "2026-03-31" });
  f.type("result", united);
  is("depart date", f.fields.date.value, "2026-03-23");
  is("return date", f.fields.returnDate.value, "2026-03-29");
  is("leg", f.fields.leg.value, "roundtrip");
  is("times", [f.fields.time.value, f.fields.arrive.value], ["08:35", "13:21"]);
  is("return times", [f.fields.returnTime.value, f.fields.returnArrive.value],
     ["13:42", "01:17"]);
  is("durations", [f.fields.duration.value, f.fields.returnDuration.value],
     ["7h 46m", "8h 35m"]);
  is("readout names the date", /Mon, Mar 23/.test(f.fields.resultRead.textContent), true);
}

// A yearless result takes its year from the box, which is the trip's own
// window — that is what the prefilled date is good for.
{
  const f = form({ date: "2026-03-01" });
  f.type("result", "Mon, Mar 23\n8:35 AM – 1:21 PM  IAD–RNO");
  is("yearless depart date", f.fields.date.value, "2026-03-23");
}

// One way: the outbound date lands and the return box is left alone.
{
  const f = form({ date: "2026-03-01", returnDate: "2026-03-31" });
  f.type("result", "Mar 23, 2026  9:10 pm – 11:59 pm  SMF–SEA  1h 55m  nonstop");
  is("one way depart", f.fields.date.value, "2026-03-23");
  is("one way return untouched", f.fields.returnDate.value, "2026-03-31");
  is("one way leg", f.fields.leg.value, "");
}

// A result with no date in it leaves the prefilled date where it is rather
// than clearing it: the trip's start is a better guess than nothing.
{
  const f = form({ date: "2026-03-01" });
  f.type("result", "8:35 AM – 1:21 PM  IAD–RNO  7h 46m  nonstop");
  is("no date keeps prefill", f.fields.date.value, "2026-03-01");
  is("but reads the times", f.fields.time.value, "08:35");
}

// Emptying the paste box puts the readout back and leaves the fields as the
// last paste left them.
{
  const f = form({ date: "2026-03-01" });
  f.type("result", "Mar 23, 2026  8:35 AM – 1:21 PM");
  f.type("result", "");
  is("cleared box keeps date", f.fields.date.value, "2026-03-23");
}

// A pasted URL still wins its own fields, and a search URL with no return
// date clears the trip's end date rather than passing it off as the flight's.
{
  const f = form({ date: "2026-03-01", returnDate: "2026-03-31" });
  f.type("url", "https://www.kayak.com/flights/BWI-DEN/2026-12-04/2026-12-10");
  is("url depart", f.fields.date.value, "2026-12-04");
  is("url return", f.fields.returnDate.value, "2026-12-10");
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
