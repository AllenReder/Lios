#!/usr/bin/env node
// PROTOTYPE ONLY — do not ship. See LOCATION-GRAMMAR.md and GitHub issue #4.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const cases = [
  ["photos:", "Space Path to the Catalog Root"],
  ["photos:/docs/", "Space Path whose source trailing slash means directory contents"],
  ["./photos:", "explicit Local Location with a colon"],
  ["C:\\archive\\photos:", "Windows drive path wins before Space Path parsing"],
  ["\\\\server\\share\\photos:", "UNC Local Location wins before Space Path parsing"],
  ["vault:/docs", "unregistered Space Name is an error, not a silently local path"],
  ["photos:docs", "Space Paths always use an absolute Catalog path"],
  ["photos:/docs", "the argv value after shell quote removal is a Space Path"],
  ['"photos:/docs"', "literal quote characters remain a Local Location"],
  ["photos:/", "Catalog Root has no trailing-slash mapping distinction"],
  ["/", "POSIX Local Location root for Linux and macOS"],
  ["", "an empty raw operand is rejected"],
  ["a:/docs", "a one-letter prefix is Windows drive syntax, never a Space Path"],
];

function isSpaceName(value) {
  return /^[a-z][a-z0-9_-]{1,31}$/.test(value);
}

function isPotentialSpaceName(value) {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:(?:[\\/]|$)/.test(value) || /^[A-Za-z]:[^/\\]/.test(value);
}

function isExplicitLocal(value) {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.startsWith("/") ||
    value.startsWith("\\")
  );
}

function parseRemote(name, suffix, spaces) {
  if (!isSpaceName(name)) {
    throw new Error(
      "invalid Space Name " +
        JSON.stringify(name) +
        "; use a registered lowercase alias with two to 32 characters or make the Local Location explicit",
    );
  }
  if (!spaces.includes(name)) {
    throw new Error(
      "Space Name " +
        JSON.stringify(name) +
        " is not registered; use ./ or .\\ for a Local Location with a colon",
    );
  }
  if (suffix === "") {
    return { kind: "Space Path", spaceName: name, catalogPath: "/", trailingSlash: false };
  }
  if (!suffix.startsWith("/")) {
    throw new Error("a Space Path after name: must be an absolute Catalog path beginning with /");
  }
  if (suffix.includes("\\")) {
    throw new Error("a Space Path uses forward slashes; backslashes indicate a Local Location");
  }
  if (suffix === "/") {
    return { kind: "Space Path", spaceName: name, catalogPath: "/", trailingSlash: false };
  }
  const trailingSlash = suffix.endsWith("/");
  const catalogPath = trailingSlash ? suffix.slice(0, -1) : suffix;
  const segments = catalogPath.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("a Catalog path cannot contain empty, . or .. segments");
  }
  return { kind: "Space Path", spaceName: name, catalogPath, trailingSlash };
}

function parseLocal(value) {
  const isRoot =
    value === "/" ||
    value === "\\" ||
    /^[A-Za-z]:[\\/]$/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+\\?$/.test(value);
  return {
    kind: "Local Location",
    path: value,
    trailingSlash: !isRoot && /[\\/]$/.test(value),
  };
}

function parseOperand(raw, spaces) {
  if (!raw) throw new Error("an operand cannot be empty");
  if (isWindowsDrivePath(raw) || isExplicitLocal(raw)) {
    return parseLocal(raw);
  }
  const colon = raw.indexOf(":");
  if (colon >= 0) {
    const name = raw.slice(0, colon);
    const suffix = raw.slice(colon + 1);
    if (isSpaceName(name) || (suffix.startsWith("/") && isPotentialSpaceName(name))) {
      return parseRemote(name, suffix, spaces);
    }
  }
  return parseLocal(raw);
}

function grammar() {
  return [
    "Recommended grammar",
    "  Operand         ::= Space Path | Local Location",
    "  Space Path      ::= Space Name ':' | Space Name ':/' | Space Name ':/' Catalog Path [ '/' ]",
    "  Catalog Path    ::= Catalog Segment ( '/' Catalog Segment )*",
    "  Catalog Segment ::= nonempty, not . or .., and contains no backslash",
    "  Space Name      ::= registered lowercase alias: [a-z][a-z0-9_-]{1,31}",
    "  Local Location  ::= Windows Drive Path | UNC Path | Explicit Local Path | Bare Local Path",
    "",
    "Precedence",
    "  1. Windows drive-relative/absolute paths and UNC paths are always Local Locations.",
    "  2. An explicit local prefix is always a Local Location.",
    "  3. A valid-looking name: is a Space Path attempt; it must name a registered local Space Name.",
    "  4. Other bare operands are Local Locations. Prefix colon-containing local names with ./ or .\\.",
    "  5. A one-letter prefix before : is always Windows drive syntax, so Space Names need two characters.",
    "",
    "Roots",
    "  photos: and photos:/ are the same Catalog Root (no trailing-slash mapping distinction).",
    "  /, C:\\, and \\\\server\\share are Local Location roots (no trailing-slash mapping distinction).",
    "",
    "Breaking migration recommendation",
    "  One-character aliases are rejected at upgrade because a: is Windows drive syntax.",
    "  Report the exact local alias and an actionable space rename command; never auto-rename it.",
    "",
    "Shell quoting",
    "  A shell turns quoted photos:/docs into the argv string photos:/docs before parsing.",
    "  Literal quote characters in argv are ordinary Local Location characters, not parser syntax.",
  ].join("\n");
}

function showCases() {
  return cases
    .map(function (entry, index) {
      return "  " + (index + 1) + ". " + entry[0].padEnd(28) + entry[1];
    })
    .join("\n");
}

function render(state) {
  if (output.isTTY) output.write("\x1b[2J\x1b[H");
  output.write("\x1b[1mLios location grammar prototype — " + state.view + "\x1b[0m\n");
  output.write(
    "\x1b[2mRegistered local Space Names: " +
      (state.spaces.join(", ") || "(none)") +
      " · parser is portable across Windows, Linux, and macOS\x1b[0m\n\n",
  );

  if (state.view === "grammar") output.write(grammar() + "\n\n");
  if (state.view === "cases") output.write("Curated cases\n" + showCases() + "\n\n");
  if (state.last) {
    output.write("\x1b[1mLast parse\x1b[0m\n");
    output.write(JSON.stringify(state.last, null, 2) + "\n\n");
  }
  if (state.message) output.write("\x1b[1mResult\x1b[0m\n" + state.message + "\n\n");

  output.write("\x1b[1mCommands\x1b[0m\n");
  output.write("  grammar             show the grammar and precedence\n");
  output.write("  cases               show curated operands\n");
  output.write("  case NUMBER         parse a curated operand\n");
  output.write("  parse OPERAND       parse one argv operand after shell quote removal\n");
  output.write("  spaces photos,archive replace registered local Space Names in memory\n");
  output.write("  spaces clear        simulate a Lios Home with no registered Space Names\n");
  output.write("  q                   quit\n");
}

async function run() {
  const state = {
    view: "grammar",
    spaces: ["photos", "archive"],
    last: null,
    message: "Use the curated cases or parse any operand.",
  };
  const terminal = readline.createInterface({ input, output });
  while (true) {
    render(state);
    const answer = (await terminal.question("> ")).trim();
    if (answer === "q" || answer === "quit") break;
    if (answer === "grammar" || answer === "cases") {
      state.view = answer;
      state.message = "";
      continue;
    }
    if (answer === "spaces clear") {
      state.spaces = [];
      state.message = "Registered local Space Names cleared only in this in-memory prototype.";
      continue;
    }
    if (answer.startsWith("spaces ")) {
      const names = answer
        .slice("spaces ".length)
        .split(",")
        .map(function (name) {
          return name.trim();
        })
        .filter(Boolean);
      const invalid = names.find(function (name) {
        return !isSpaceName(name);
      });
      if (invalid) {
        state.message =
          "Invalid Space Name " +
          JSON.stringify(invalid) +
          "; aliases must be lowercase and two to 32 characters.";
        continue;
      }
      if (new Set(names).size !== names.length) {
        state.message = "Duplicate Space Names are not a valid registration state.";
        continue;
      }
      state.spaces = names;
      state.message = "Registered local Space Names changed only in this in-memory prototype.";
      continue;
    }
    let operand;
    if (answer.startsWith("case ")) {
      const index = Number(answer.slice("case ".length)) - 1;
      const selected = cases[index];
      if (!selected) {
        state.message = "Unknown curated case.";
        continue;
      }
      operand = selected[0];
    } else if (answer.startsWith("parse ")) {
      operand = answer.slice("parse ".length);
    } else {
      state.message = "Use grammar, cases, case NUMBER, parse OPERAND, spaces a,b, or q.";
      continue;
    }
    try {
      state.last = parseOperand(operand, state.spaces);
      state.message = JSON.stringify(operand) + " parsed successfully.";
    } catch (error) {
      state.last = null;
      state.message = "Error for " + JSON.stringify(operand) + ": " + error.message;
    }
  }
  terminal.close();
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
