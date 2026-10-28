// Tests for the brand mark on a card.
//
// Two rules do all the work and both are easy to get backwards: a listing's
// URL outranks whatever the card is called, and a name only ever matches
// inside its own kind — a cabin labelled "Alaska" is not a flight on Alaska,
// and a booking at a National Park is not a car from National.
//
//   node tests/brand.test.mjs

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
// A const runs to whichever closing line sits at column zero.
function extractConst(name){
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  const head = src.slice(start, src.indexOf("\n", start)).trimEnd();
  const close = head.endsWith("[") ? "\n];" : head.endsWith("{") ? "\n};" : null;
  if (!close) return src.slice(start, src.indexOf(";\n", start) + 2) + "\n";
  return src.slice(start, src.indexOf(close, start) + close.length) + "\n";
}

const B = new Function(
  extractConst("esc") + extractConst("BRANDS") + extractConst("brandInitials") +
  extract("safeExternalUrl") + extract("brandHost") + extract("brandInk") +
  extract("brandFor") + extract("brandMark") +
  "return { brandFor, brandMark, brandInk, brandInitials };"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}
const domainOf = (...args) => (B.brandFor(...args) || {}).domain ?? null;

// The airline field names the brand.
is("united", domainOf("United", null, ["air"]), "united.com");
is("delta", domainOf("Delta", null, ["air"]), "delta.com");
is("inside a longer string", domainOf("Alaska Airlines", null, ["air"]), "alaskaair.com");
is("unknown airline", domainOf("Icelandair", null, ["air"]), null);
is("no airline", domainOf(null, null, ["air"]), null);

// A listing's URL names it even when the card is called something else —
// which is the usual case, since nobody titles a rental "Airbnb".
is("airbnb by url", domainOf("Cabin above the lake", "https://www.airbnb.com/rooms/123",
   ["stay"]), "airbnb.com");
is("url beats the label", domainOf("Hertz pickup", "https://www.avis.com/en/home",
   ["car"]), "avis.com");
is("subdomain", domainOf("", "https://secure.booking.com/x", ["stay"]), "booking.com");
is("scheme-less url", domainOf("", "vrbo.com/1234", ["stay"]), "vrbo.com");

// Kind scoping: the same word means different things in different lanes.
is("alaska the place", domainOf("Alaska cabin", null, ["stay"]), null);
is("a national park", domainOf("National Park cabin", null, ["stay"]), null);
is("national the car", domainOf("National Car Rental", null, ["car"]), "nationalcar.com");
is("budget the car", domainOf("Budget", null, ["car"]), "budget.com");

// Longest name first, so a short entry sitting inside a longer one doesn't
// win the label.
is("longest wins", domainOf("Avis Budget Group", null, ["car"]), "budget.com");

// A site we've never listed is still a brand — the icon service knows far
// more companies than this table does.
{
  const b = B.brandFor("Someone's cabin", "https://kurtosys-lodges.co.uk/x", ["stay"]);
  is("unlisted host", b.domain, "kurtosys-lodges.co.uk");
  is("unlisted name", b.name, "kurtosys-lodges");
  const again = B.brandFor("Different title", "http://kurtosys-lodges.co.uk/y", ["stay"]);
  is("same colour every time", again.color, b.color);
}
is("junk url", domainOf("", "not a url at all", ["stay"]), null);

// Letters on the roundel have to be legible against the brand's own colour.
is("dark brand", B.brandInk("#002244"), "#fff");
is("spirit yellow", B.brandInk("#FFEB00"), "#1a1a1a");
is("hertz yellow", B.brandInk("#FFD100"), "#1a1a1a");
is("no colour", B.brandInk(null), "#fff");

// Initials for a brand with no airline code.
is("one word", B.brandInitials("Airbnb"), "A");
is("two words", B.brandInitials("Best Western"), "BW");
is("dotted", B.brandInitials("Hotels.com"), "HC");

// The mark itself: the logo, the fallback letters, and nothing at all when
// there's no brand to show.
{
  const html = B.brandMark("United", null, ["air"]);
  is("mark has the logo", html.includes("icons.duckduckgo.com/ip3/united.com.ico"), true);
  is("mark has the code", html.includes("<i>UA</i>"), true);
  is("mark drops a logo that fails", html.includes('onerror="this.remove()"'), true);
  is("nothing to show", B.brandMark("Icelandair", null, ["air"]), "");
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
