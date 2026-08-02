# Canonical transfer and safety contract

This decision answers [issue #6](https://github.com/AllenReder/Lios/issues/6).
It is the target CLI contract; it does not implement the current 0.2 surface.

## Core rule

Every mutating `mkdir`, `copy`, `sync`, `move`, and `delete` command first
derives one inspectable, serialized action list. It owns exactly one mutable
destination root: a Local Location subtree or, when a Lios Space changes, one
destination Catalog. It records normalized operands, source/destination
baselines, ordered filters, mapping, and sorted `create`, `update`, `skip`,
`delete`, and `type-change` actions.

When a command changes a Catalog or Content Object, confirmation makes that
exact action list a **Transfer Plan**, as defined in `CONTEXT.md`, and commits
it to one Durable Task. A Space Path → Local Location command changes neither,
so confirmation commits its same immutable action list only to a Durable Task.
The Task Worker may retry or resume actions, but it must never silently rescan
or recompute a confirmed action list. A stale baseline instead fails the task
safely and requires a new command and action list (and, for a Lios write, a new
Transfer Plan).

## Commands and operand directions

| Command | Operands | Contract |
| --- | --- | --- |
| `copy` (`cp`) | `SOURCE... DESTINATION` | Accepts one or more sources. Sources must be all Local Locations, or all Space Paths from one source Lios Space; mixed source classes and multiple source Lios Spaces are rejected. The supported pairs are Local Location → Space Path, Space Path → Local Location, and Space Path → Space Path. Local Location → Local Location is rejected. Copy never deletes destination-only entries. |
| `sync` | `SOURCE DESTINATION` | Accepts exactly one source and one destination in the same three supported pairs as `copy`; Local Location → Local Location is rejected. It makes the mapped destination subtree an exact source mirror, including destination-only deletion in that subtree. `sync --delete` is not a canonical option; `sync` already mirrors. |
| `move` (`mv`) | `SOURCE DESTINATION` | Moves exactly one Space Path inside the same Lios Space. Its confirmed Transfer Plan is one Catalog Node rename/relocation in that Catalog, never a Local Location move or a cross-Lios-Space move. To move between Lios Spaces, use `copy`, verify it, then explicitly `delete` the source. |
| `delete` (`rm`) | `SPACE_PATH...` | All Space Paths must use one registered Space Name, so one command changes one Catalog. It removes Catalog Nodes only; it never promises immediate reclamation of encrypted Content Objects or Dataset Repository capacity. Nonempty directories and a Catalog Root require `--recursive`; the root is shown as a full Lios Space destructive operation in the action list. |

For Space Path → Space Path work, planning captures a read-only source Catalog
snapshot while the destination Catalog is the sole mutable Catalog. If both
paths use the same Lios Space, their resolved source and target subtrees must
not overlap; the final Catalog transaction changes only the target subtree.
The Task Worker may stream through the user's machine or use a compatible
server-side optimization, but mapping, filters, confirmation, progress, and
failure semantics do not change.

## Mapping and trailing slashes

- A directory source without a trailing directory separator maps the named
  directory itself; one with a trailing directory separator maps its contents.
  For a Space Path the separator is `/`; for a Local Location it is `/` or `\`
  as accepted by the location grammar.
- `photos:` and `photos:/` are both the Catalog Root and have no distinct
  trailing-slash mapping. A Local Location root likewise has no distinct
  trailing-separator mapping. A file source rejects a trailing directory
  separator.
- A destination trailing directory separator asserts directory treatment; it
  never changes source mapping. With multiple `copy` sources, the destination
  must be a directory (existing or explicitly asserted with a separator).
- For one file source, an existing destination directory or a destination with
  a trailing directory separator receives the source basename; the latter
  creates the asserted directory when absent. An existing non-directory or a
  nonexistent destination without a trailing separator is the exact file
  target. For one directory source and an existing destination directory, no
  source separator maps the named directory below it, while a source separator
  maps the directory's contents into it. For a nonexistent destination, no
  source separator makes that destination the mapped directory itself; a source
  separator creates that destination directory and maps the contents into it.
- `sync` uses those same resolved-target rules. Thus `sync dir DEST` mirrors
  `dir` beneath an existing directory `DEST`, while `sync dir/ DEST` mirrors
  the contents of `dir` into `DEST`; an absent `DEST` is created according to
  the preceding rule. A file source maps to one destination file and never
  deletes siblings of that file.
- The resolved target subtree is displayed in every rendered action list. A
  command whose resolved source and destination are the same location is
  rejected.
- For `copy` and `sync` within one Lios Space, the resolved source and target
  subtrees must not overlap in either direction; an equal, ancestor, or
  descendant request is rejected.
- Before confirmation, `copy` rejects two distinct sources whose resolved
  outputs are the same path or overlap as ancestor and descendant. It never
  chooses an argv-order winner for colliding source outputs.
- `move` refers to a Catalog Node, not its contents; it rejects a trailing
  slash on the source. An existing destination directory, or a destination
  ending in `/`, is its parent and receives the source basename; otherwise the
  destination is the exact target. Moving a node into itself or one of its
  descendants is rejected.

## Conflicts and overwrite behavior

- For `copy` and `sync`, different same-type file content is source-wins by
  default and is an `update` action. For `copy`, `--no-clobber` changes that
  action to `skip`. `sync` rejects `--no-clobber`, because skipping an update
  would violate its exact-mirror contract.
- Directories merge for `copy`; `sync` reconciles the mapped tree exactly.
- `move` never merges with or overwrites an existing same-type resolved target:
  it rejects that target. A file/directory conflict in `copy`, `sync`, or
  `move` is rejected unless `--replace-type --yes` is present. The action list
  labels every resulting `type-change`; a Catalog Root or Local Location root
  cannot be type-replaced.
- Per-item interactive conflict resolution is not a canonical transfer mode.
  Users inspect the action list, use filters or `--no-clobber`, and approve the
  whole action list at once. This prevents per-item answers from changing
  mid-task.

## Filters and deletion protection

The filter stream is one ordered, first-match-wins sequence evaluated relative
to the mapped source root. An unmatched path is included.

```text
+ PATTERN    include
- PATTERN    exclude
```

- `--filter RULE` appends one rule and `--filter-from FILE` appends its
  nonblank, non-comment lines at that exact argv position.
- `--include`, `--exclude`, `--include-from`, and `--exclude-from` are
  convenience spellings that expand to the same `+` or `-` rules at their
  literal command-line position. The CLI must preserve that order and must not
  regroup option families.
- Patterns always use `/`, including on Windows. `*`, `?`, and `**` have glob
  meaning; a leading `/` is anchored to the mapped root; a trailing `/` matches
  a directory. An excluded directory is not traversed.
- An excluded destination Catalog Node or Local Location entry, including its
  excluded subtree, is protected from `sync` deletion by default, even when it
  has no matching source entry. Canonical Lios exposes no `--delete-excluded`
  override.

## Planning, dry run, and confirmation

Planning happens after all operands are parsed, source trees are read, filters
are applied, and destination baselines are captured. It produces the
serialized but unconfirmed action list described above. A planning/read error
creates neither that list nor a Durable Task and changes nothing.

| Invocation | Result |
| --- | --- |
| Default on a TTY | Render the complete unconfirmed action list, including action counts, paths, target subtree, baseline identities, type changes, and destructive deletes. A yes/no confirmation atomically persists it and queues one Durable Task. If it changes a Catalog or Content Object, that persistence makes it a Transfer Plan. |
| `--yes` | Confirms the rendered action list and queues its Durable Task without a prompt. It makes a Transfer Plan only when the action list changes a Catalog or Content Object. This is required for non-interactive execution. |
| `--dry-run` | Persists the exact unconfirmed action list and its baselines in one Durable Task in `planned` state, but does not create a Transfer Plan or perform a source/destination write. It returns that task identifier. `lios task resume ID` asks for the same confirmation (or accepts `--yes`) and then queues that exact serialized list without recomputation; it becomes a Transfer Plan only for a Catalog or Content Object write. |
| `--detach` | Is valid only after an action list is confirmed for execution; it returns the Durable Task identifier rather than waiting. It is mutually exclusive with `--dry-run`, which already returns an inert planned task. |
| `--json` or `--no-input` without `--yes` | Never prompt. Return the stable interaction-required/no-input failure category. `--dry-run` remains valid because it performs no transfer. |

`--dry-run` is mutually exclusive with `--yes` and `--detach`; `--yes` belongs
on the later `task resume ID` invocation when an automation client chooses to
confirm a planned task.

A user declining an unconfirmed action list leaves no Durable Task. A planned
task from `--dry-run` has no remote, Catalog, or Local Location effect until
`task resume` confirms it. The detailed presentation and numeric exit mapping
are defined by the task/automation contract.

## Confirmation, execution, failure, and retry

At confirmation, Lios atomically records the action list and its source and
destination baselines, then queues its Durable Task. A Catalog or Content
Object write is recorded as one Transfer Plan; a Space Path → Local Location
operation remains an immutable task action list, not a Transfer Plan. For a
`--dry-run` task, confirmation promotes the already serialized list only if its
identity is unchanged; it never rescans or re-plans. Execution follows these
rules:

1. Revalidate the confirmed action list's source fingerprints and destination
   Catalog and Local Location baselines before applying actions. Never
   substitute a fresh scan.
2. When the destination is a Lios Space, the Transfer Plan stages creates,
   updates, and replacement Content Objects, then publishes the destination
   Catalog atomically. `delete` actions become visible only in that final
   Catalog transaction; a failed task cannot expose a partially deleted Catalog
   tree.
3. When the destination is a Local Location, stage each create, update, or
   replacement on that filesystem, verify it, then publish it with the
   filesystem's atomic per-file replacement primitive. Lios does not promise a
   whole-tree atomic Local Location transaction. It starts no planned local
   deletion until all source reads and non-delete actions succeed and source
   fingerprints are revalidated. A failure can therefore leave completed
   creates or updates visible; after deletion starts, it can leave completed
   planned deletions visible. It never rolls those results back by guesswork.
4. Any source-read failure, source mutation, stale Catalog, or changed Local
   Location destination fails the Durable Task as `stale_plan` or
   `source_unreadable` before the next destructive action. In particular,
   `sync` suppresses every not-yet-started planned delete.
5. The Durable Task records completed-action checkpoints and expected output
   fingerprints. On retry, completed Local Location actions must still match
   their recorded result and unfinished destination Catalog Nodes or Local
   Location entries must still match the original baseline; otherwise the task
   is stale. The retry resumes only unfinished listed actions and never
   recomputes the mapping or deletions.
6. A transient remote or local I/O failure may be retried by the Task Worker or
   with `task retry`, but only against the same confirmed action list (and the
   same Transfer Plan where one exists) and after baseline validation. A stale
   action list, invalid input, or source mutation is not automatically retried;
   the user must issue a new transfer command.
7. A completed Transfer Plan or confirmed task action list is immutable
   historical evidence. A retry never adds, removes, reorders, or reclassifies
   actions.

This also means that a failed upload may leave unreachable encrypted staging
objects, but it cannot change the user-visible Catalog or justify a later
unplanned delete.

## Destructive-operation guardrails

- `copy` is non-deleting in every direction: it never removes a
  destination-only entry. An explicit `--replace-type --yes` can remove only
  the listed conflicting target as a `type-change` action.
- `sync` is mirror-by-default only inside the displayed resolved destination
  subtree. An empty directory source therefore plans deletion only inside that
  subtree, never outside it.
- `delete` requires `--recursive` for a nonempty directory or Catalog Root and
  is a Catalog write, so it follows the Transfer Plan confirmation/`--yes`
  rules.
- Source scan/read errors, excluded paths, stale baselines, type conflicts, and
  declined confirmation all prevent destination deletion.
- Every Space Path includes a registered Space Name; no transfer accepts an
  ad hoc Repository Address.

## Consequences

The old opt-in `sync --delete` behavior is replaced by explicit canonical
`sync` mirror semantics. The breaking-release warning, compatibility handling,
and removal schedule are defined in issue #8. Task states, Ctrl-C, progress,
JSON envelopes beyond plan output, and final exit-code mapping are defined in
issue #7.
