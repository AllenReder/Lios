#!/usr/bin/env node
// PROTOTYPE ONLY — do not ship. See README.md and GitHub issue #3.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const globalOptions = [
  "--home DIR       use DIR/.lios instead of the default Lios Home",
  "--json           emit one schema-versioned document; never prompt or show progress",
  "--no-input       reject any action that would require confirmation or a secret prompt",
  "--quiet           suppress human status lines (errors still go to stderr)",
  "--help, --version",
];

const topics = {
  overview: {
    title: "Proposed top-level help",
    body: `Usage: lios [GLOBAL OPTION] <COMMAND> [ARGS]\n\nCommands:\n  config                         guided first-use journey\n  setup                          initialize a Lios Home (non-interactive)\n  auth login|status|logout        manage the ModelScope Token\n  key backup|verify|import|status manage the Recovery Key\n  space create|init|add|discover|list|show|rename|remove\n                                  manage registered Space Names\n  list (ls) SPACE_PATH            list Catalog children\n  search SPACE_PATH QUERY         find Catalog Nodes\n  mkdir SPACE_PATH...             create Catalog directories\n  copy (cp) SOURCE... DEST        non-deleting transfer\n  sync SOURCE DEST                exact source mirror, only with explicit deletion consent\n  move (mv) SOURCE DEST           rename or relocate in one Lios Space\n  delete (rm) SPACE_PATH...       delete Catalog Nodes, never raw remote objects\n  verify SPACE_NAME               verify a Lios Space\n  task list|show|wait|pause|resume|retry|cancel|clear\n  worker status|stop              inspect the shared Task Worker`,
  },
  firstUse: {
    title: "First-use journey",
    body: `1. lios config\n   Select a Lios Home, authenticate, create/import/verify the Recovery Key,\n   discover or create a Dataset Repository, then register its Space Name.\n\n2. lios space create photos --dataset family-photos\n   Equivalent composable path: setup → auth login → key import/backup → space create.\n\n3. lios copy ./Camera/ photos:/2026/ --progress\n   Local Location → Space Path. The trailing slash copies Camera's contents.\n\n4. lios copy photos:/2026/ ./Restore/\n   Space Path → Local Location.\n\n5. lios copy photos:/2026/ archive:/2026/\n   Space Path → Space Path. Visible semantics do not depend on worker optimization.\n\n6. lios sync ./Albums/ photos:/albums/ --delete --yes\n   An immutable Transfer Plan is shown and confirmed before any deletion.\n\n7. lios task list\n   The CLI and Desktop observe the same Durable Tasks in the same Lios Home.`,
  },
  locations: {
    title: "Space Paths are explicit operands",
    body: `SPACE_PATH grammar\n  photos:             Catalog Root of the registered Space Name “photos”\n  photos:/2026         absolute Catalog path in “photos”\n  photos:/2026/        same path; trailing slash means directory contents when a source\n\nLOCAL_LOCATION examples\n  ./photos:            explicit local file whose name contains a colon\n  C:\\backups\\photos:  Windows local path; drive letters always win\n  /mnt/photos          POSIX local path\n\nA Dataset Repository becomes a Lios Space only after initialization. Operands never accept\nan ad hoc Repository Address: register it first with “lios space add NAME OWNER/DATASET”.`,
  },
  transfers: {
    title: "Transfers and safety",
    body: `copy (cp) SOURCE... DEST\n  Copies without deleting destination-only entries.\n\nsync SOURCE DEST [--delete --yes]\n  Mirrors the source. Destination deletion is opt-in, never occurs after source/read errors,\n  and excludes protect matching destination paths by default.\n\nShared options\n  --dry-run                 render the immutable Transfer Plan that confirmation persists unchanged\n  --exclude PATTERN         append to an ordered, first-match-wins filter stream\n  --exclude-from FILE       append patterns from FILE at that point in the stream\n  --replace-type --yes      authorize a file/directory type replacement\n  --detach                  return a Durable Task ID; Task Worker continues after exit\n  --progress                human terminal progress only\n\nEvery write — mkdir, copy, sync, move, and delete — creates one inspectable Durable Task plan.\nConfirmation persists its source/destination baselines and actions; execution applies that plan\nwithout silently recomputing it.`,
  },
  automation: {
    title: "Automation and help layout",
    body: `Every command follows:\n  lios <command> --help          one-screen summary, operands first, then options and examples\n  lios <command> <subcommand> --help\n\n--json emits exactly one document to stdout:\n  success: { "schema_version": 1, "ok": true, "command": "copy", "result": { "task_id": "..." } }\n  failure: { "schema_version": 1, "ok": false, "command": "copy", "error": { "code": "conflict", "message": "..." } }\n\nExit categories:\n  0 success     1 operational failure     2 usage/input failure\n  3 confirmation declined / no-input       4 authentication or authorization failure\n  5 conflict or stale baseline              130 user interruption\n\n--json and --no-input reject interactive prompts. “--detach” prints a Task ID and exits;\nwithout it, a client waits for that same Durable Task and can hand it to Desktop observation.`,
  },
};

function render(topicKey) {
  if (output.isTTY) output.write("\x1b[2J\x1b[H");
  const topic = topics[topicKey];
  output.write(`\x1b[1mLios CLI help prototype — ${topic.title}\x1b[0m\n`);
  output.write("\x1b[2mQuestion: can this be learned from help without hiding the safe automation contract?\x1b[0m\n\n");
  output.write(`${topic.body}\n\n`);
  output.write("\x1b[1mGlobal options\x1b[0m\n");
  output.write(`${globalOptions.map((option) => `  ${option}`).join("\n")}\n\n`);
  output.write("\x1b[1mViews\x1b[0m  [1] first-use  [2] locations  [3] transfers  [4] automation  [5] overview  [q] quit\n");
}

async function run() {
  let current = "overview";
  const terminal = readline.createInterface({ input, output });
  while (true) {
    render(current);
    const answer = (await terminal.question("> ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") break;
    current = {
      "1": "firstUse",
      "2": "locations",
      "3": "transfers",
      "4": "automation",
      "5": "overview",
    }[answer] ?? current;
  }
  terminal.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
