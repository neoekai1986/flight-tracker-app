// Tests for Enter saving the add-flight form.
//
// The rule is one line of code and several exceptions, and the exceptions
// are the point: Enter in the paste box has to stay a new line, or the one
// field that exists to take several lines of a search result can only ever
// hold one.
//
// wireEnterToSave only asks its holder for addEventListener and its button
// for click, so a pair of stand-ins is enough to drive it.
//
//   node tests/enter.test.mjs

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

const wireEnterToSave = new Function(
  extract("wireEnterToSave") + "return wireEnterToSave;"
)();

let passed = 0, failed = 0;
function is(what, got, want){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b){ passed++; return; }
  failed++;
  console.error(`FAIL ${what}\n  got  ${a}\n  want ${b}`);
}

function harness({ disabled = false } = {}){
  let onKey = null;
  const holder = { addEventListener(type, fn){ if (type === "keydown") onKey = fn; } };
  let saves = 0;
  const saveBtn = { disabled, click(){ saves++; } };
  wireEnterToSave(holder, saveBtn);
  return (target, key = "Enter", mods = {}) => {
    let prevented = false;
    const before = saves;
    onKey({ key, isComposing: false, ...mods, target, preventDefault(){ prevented = true; } });
    return { saved: saves > before, prevented };
  };
}

const el = (tagName, type) => ({ tagName, type });
const fire = harness();

// The ordinary case, in every shape of single-line field the form has.
is("text", fire(el("INPUT", "text")), { saved: true, prevented: true });
is("date", fire(el("INPUT", "date")), { saved: true, prevented: true });
is("time", fire(el("INPUT", "time")), { saved: true, prevented: true });
is("number", fire(el("INPUT", "number")), { saved: true, prevented: true });
is("checkbox", fire(el("INPUT", "checkbox")), { saved: true, prevented: true });
is("select", fire(el("SELECT")), { saved: true, prevented: true });
is("lowercase tag", fire(el("input", "text")), { saved: true, prevented: true });

// Enter belongs to the field: a pasted search result is several lines by
// nature, and so are notes.
is("textarea", fire(el("TEXTAREA")), { saved: false, prevented: false });
// A button is already doing something with Enter, and a file field opens
// its picker.
is("button", fire(el("BUTTON")), { saved: false, prevented: false });
is("file", fire(el("INPUT", "file")), { saved: false, prevented: false });
is("not a field at all", fire(el("DIV")), { saved: false, prevented: false });

// Only Enter, and only on its own.
is("another key", fire(el("INPUT", "text"), "a"), { saved: false, prevented: false });
is("escape", fire(el("INPUT", "text"), "Escape"), { saved: false, prevented: false });
is("shift+enter", fire(el("INPUT", "text"), "Enter", { shiftKey: true }),
   { saved: false, prevented: false });
is("cmd+enter", fire(el("INPUT", "text"), "Enter", { metaKey: true }),
   { saved: false, prevented: false });
is("ctrl+enter", fire(el("INPUT", "text"), "Enter", { ctrlKey: true }),
   { saved: false, prevented: false });
is("alt+enter", fire(el("INPUT", "text"), "Enter", { altKey: true }),
   { saved: false, prevented: false });

// Mid-composition Enter is choosing a character, not filing a flight.
is("composing", fire(el("INPUT", "text"), "Enter", { isComposing: true }),
   { saved: false, prevented: false });

// A save already under way doesn't get a second one, but the key is still
// swallowed rather than doing something else with it.
is("already saving", harness({ disabled: true })(el("INPUT", "text")),
   { saved: false, prevented: true });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
