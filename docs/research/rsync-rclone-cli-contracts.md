# rsync and rclone CLI contracts relevant to Lios

## Scope

This note answers which behaviors from rsync and rclone should inform Lios for
command naming, operands, trailing slashes, copy versus sync, filters, dry runs,
progress, exit status, configuration, and Space-to-Space transfer. It compares
the current official releases on 2026-08-02: [rsync
3.4.4](https://github.com/RsyncProject/rsync/releases/tag/v3.4.4) and [rclone
1.75.0](https://github.com/rclone/rclone/releases/tag/v1.75.0).

## Decision-relevant answer

Lios should not promise a generic “rsync/rclone-like” contract because the
tools conflict in several visible places. The coherent combination is:

1. Use rclone's command taxonomy and configuration model: canonical `copy`,
   `sync`, `move`, `delete`, and `config` commands operating on configured
   aliases.
2. Use rsync's source trailing-slash distinction: `source` means the named
   directory while `source/` means its contents. Do not inherit rclone's rule
   that every directory source behaves as though it ended in `/`.
3. Use rclone's deletion split: `copy` never removes destination entries;
   `sync` makes the destination mirror the source and may delete.
4. Define a Lios-native ordered filter contract. Both tools stop at the first
   matching rule, but their flag ordering and deletion-side rules differ.
5. Make `--dry-run` render the exact durable Transfer Plan that execution will
   apply, rather than a prediction that is silently rescanned.
6. Define Lios-specific progress and exit-status contracts. In particular,
   `-P` and usage-error exit codes mean different things in the two tools.
7. Support Space Path to Space Path transfers as normal syntax, like rclone.
   Server-side optimization is an implementation capability, not a different
   grammar.

## Comparison

### Command naming

Rsync is one copy command, `rsync [OPTION...] SRC... [DEST]`. Deleting
destination-only entries is enabled by `--delete`; it is not a separate
subcommand. Rsync also accepts multiple source operands. ([rsync 3.4.4 man-page
source, “SYNOPSIS” and `--delete`](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md))

Rclone has explicit verbs. Its main list distinguishes `copy` (“skipping
already copied”), `sync` (“make source and dest identical, modifying
destination only”), `move`, `delete`, `purge`, `mkdir`, and listing
commands. ([rclone command list](https://rclone.org/docs/#subcommands))

**Conflict:** rsync expresses “copy versus mirror” as an option; rclone
expresses it as separate verbs.

**Lios direction:** use rclone's long verbs as the canonical interface, with
Unix short names only as stable aliases. Machine output should always name the
canonical verb. Whether `copy` accepts multiple sources needs its own decision.

Rclone also has `copyto` to rename a single file at the destination.
([rclone `copyto`](https://rclone.org/commands/rclone_copyto/#synopsis)) Lios
should decide whether one `copy` grammar can resolve file-versus-directory
destinations before adding another verb.

### Operands, remotes, and trailing slashes

Rsync supports local paths, `HOST:path`, `HOST::module/path`, and
`rsync://...`. It explicitly does not support copying between two remote
hosts. ([rsync “SYNOPSIS” and “GENERAL”](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#general))

Rclone uses local paths and configured `remote:path` operands. It additionally
supports ad-hoc `:backend:path` remotes and connection strings. On Windows a
single-letter remote is indistinguishable from a drive and is treated as a
drive. A local name containing `:` can be forced local with an absolute path
or `./`. ([rclone remote-path
syntax](https://rclone.org/docs/#syntax-of-remote-paths), [colon
disambiguation](https://rclone.org/docs/#copying-files-or-directories-with-in-the-names))

Lios's registered Space Name and Space Path fit rclone's configured-remote
model, but Lios should not inherit ad-hoc remotes. Requiring `name:` or
`name:/absolute/catalog/path` preserves the binding between one Lios Home,
Catalog, Recovery Key, Durable Tasks, and Task Worker.

The source trailing-slash behaviors directly conflict:

- Rsync says a source directory without `/` copies the directory by name,
  while a trailing `/` copies its contents. A destination trailing slash also
  asserts directory treatment in ambiguous single-item cases. ([rsync
  trailing-slash explanation and “COPYING TO A DIFFERENT
  NAME”](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#copying-to-a-different-name))
- Rclone says all commands behave as if a directory path had a trailing `/`:
  only its contents are copied or synced. ([rclone
  `copy`](https://rclone.org/commands/rclone_copy/#synopsis), [rclone
  `sync`](https://rclone.org/commands/rclone_sync/#synopsis))

**Lios direction:** use rsync's source distinction. Specify it exhaustively for
Local Location and Space Path sources, the Catalog Root (`photos:`), file
sources, nonexistent destinations, and destination paths ending in `/`.
Cross-platform tests must distinguish `C:\\...`, `photos:/...`, and
`./photos:`.

### Copy, sync, and deletion safety

Rsync is non-deleting unless a delete option is supplied. Excluded entries are
protected from deletion by default. Sender I/O errors disable destination
deletion unless `--ignore-errors` overrides the safeguard, and the man page
recommends a dry run before `--delete`. ([rsync
`--delete`](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md))

Rclone `copy` never deletes destination entries. Rclone `sync` makes the
destination match the source and may delete; its docs recommend `--dry-run` or
interactive mode first. It suppresses deletion after errors, and excluded
entries are retained unless `--delete-excluded` is supplied. ([rclone
`copy`](https://rclone.org/commands/rclone_copy/#synopsis), [rclone
`sync`](https://rclone.org/commands/rclone_sync/#synopsis))

**Conflict:** `sync` is intrinsically deleting in rclone; a normal rsync run is
non-deleting until `--delete` is added.

**Lios direction:** use the rclone split already chosen for the redesign:
`copy` is additive/update-only and `sync` is an exact mirror. Preserve the
safety behavior shared by both tools: source scan/read errors invalidate
planned deletes. Excluded destination Catalog Nodes should be protected by
default; an equivalent to `--delete-excluded`, if exposed, must be presented
as destructive.

### Filters

Both projects use ordered, first-match-wins rules and include unmatched paths by
default, but the details differ:

- Rsync builds one ordered list from command-line and file rules. Excluding a
  directory stops traversal. Receiver-side `protect`/`risk` rules can control
  deletion separately; common include/exclude rules affect both transfer
  visibility and deletion protection by default. ([rsync “FILTER
  RULES”](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#filter-rules))
- Rclone stops at the first matching rule, but groups separate flag families in
  a fixed order (`--include`, `--include-from`, `--exclude`,
  `--exclude-from`, `--filter`, `--filter-from`) regardless of how the
  families were interleaved on the command line. An include flag implies a
  final exclude-all rule, and the docs warn against mixing flag families.
  ([rclone filter evaluation](https://rclone.org/filtering/#how-filter-rules-work))

Both use `/` in patterns, including on Windows, and support `*`, `**`, root
anchoring with a leading `/`, and directory matching with a trailing `/`;
their full languages are not identical. ([rclone filter
patterns](https://rclone.org/filtering/#patterns-for-matching-path-file-names),
[rsync pattern matching](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#pattern-matching-rules))

**Lios direction:** define one canonical ordered `--filter` stream and one
`--filter-from` file form. If convenience `--include` and `--exclude` flags
remain, either preserve their real command-line order or reject mixed
families; do not silently use rclone's regrouping. Excluded destination nodes
remain protected from `sync` deletion by default.

### Dry run and Transfer Plan fidelity

Rsync `--dry-run` makes no changes and is commonly paired with
`--itemize-changes`. Rsync treats itemized dry-run output and the subsequent
real run as intended to be equal except for intentional changes and system-call
failures. ([rsync `--dry-run`](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md))

Rclone `--dry-run` promises no permanent changes. Its logger documentation,
however, describes reports as predictions of what *should* happen that may not
match what happens, with limitations around retries and server-side directory
moves. ([rclone `--dry-run`](https://rclone.org/docs/#n-dry-run), [rclone
logger limitations](https://rclone.org/commands/rclone_sync/#logger-flags))

**Lios direction:** offer a stronger contract through the Transfer Plan.
`--dry-run` creates and renders the same categorized plan (`create`, `update`,
`skip`, `delete`, `type-change`) that execution confirms. Once confirmed,
the plan and its source/destination baselines are persisted and a detached
Durable Task never silently recomputes them.

### Progress and output

Rsync `--progress` reports the current file; `--info=progress2` reports the
whole transfer. Its `-P` means **both** `--partial --progress`. ([rsync
`--progress`](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md))

Rclone `-P`/`--progress` renders a periodically updated terminal block with a
real-time transfer overview. ([rclone
`--progress`](https://rclone.org/docs/#p-progress))

**Conflict:** `-P` is progress-only in rclone but progress plus partial-file
retention in rsync.

**Lios direction:** make `--progress` the documented flag and do not claim a
meaning for `-P` until it is chosen. TTY progress, log lines, `--json`, and
detached-task status need separate, explicit output contracts.

### Exit status

The numeric schemes conflict immediately:

- Rsync uses `0` for success and `1` for syntax/usage, followed by detailed
  protocol, I/O, partial-transfer, signal, delete-limit, and timeout codes.
  ([rsync exit values](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#exit-values))
- Rclone uses `0` for success, `1` for uncategorized error, and `2` for
  syntax/usage, followed by not-found, retryability, severity, transfer-limit,
  no-transfer, and duration-limit codes. ([rclone exit
  codes](https://rclone.org/docs/#exit-code))

**Lios direction:** define a Lios-native stable taxonomy rather than borrowing
numbers. It should distinguish usage/configuration, not found,
authentication/key, stale Transfer Plan or conflict, partial transfer,
cancellation/interruption, and temporary versus terminal remote failure. JSON
errors and process exits should share stable symbolic categories.

### Configuration

Rclone's easiest setup is `rclone config`, an interactive session for creating
and managing named remotes and protecting configuration with a password. It
also supports non-interactive configuration through files, flags, environment,
and ad-hoc remotes. ([rclone
configuration](https://rclone.org/docs/#configure), [`rclone
config`](https://rclone.org/commands/rclone_config/#synopsis))

Rsync has no comparable client-side interactive remote registry. Host/module
locations are direct operands; `rsyncd.conf` configures a daemon rather than a
user's aliases. ([rsync “GENERAL” and “STARTING AN RSYNC
DAEMON”](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#starting-an-rsync-daemon-to-accept-connections))

**Lios direction:** use the selected guided `lios config` entry point, but have
it orchestrate Lios-specific ModelScope Token, Recovery Key, registered Lios
Spaces, and Task Worker state. Every guided action needs a composable
non-interactive and JSON equivalent.

### Space-to-Space transfer

Rsync disallows two remote hosts. Rclone accepts remote operands on both sides.
By default, it attempts server-side copy only when the remote names are the
same; unsupported remotes instead download and re-upload. Its opt-in
`--server-side-across-configs` flag can also allow compatible remotes that use
the same backend but have differently named configurations, because rclone
cannot determine that compatibility safely by default. The command grammar does
not depend on the chosen route. ([rsync
“GENERAL”](https://github.com/RsyncProject/rsync/blob/v3.4.4/rsync.1.md#general),
[rclone server-side copy](https://rclone.org/docs/#server-side-copy), [rclone
`--server-side-across-configs`](https://rclone.org/docs/#server-side-across-configs),
[rclone `copy`](https://rclone.org/commands/rclone_copy/#synopsis))

**Lios direction:** support `lios copy photos:/raw archive:/raw` and the
corresponding `sync` form even if the initial implementation streams through
the local Task Worker. Lios intentionally exposes no equivalent to rclone's
cross-configuration optimization flag: registered Space Names describe Lios
Spaces rather than arbitrary backend configurations, and route selection is a
Task Worker capability. Optimization must not alter path, filter, Transfer Plan,
confirmation, progress, or failure semantics.

## Conflict matrix

| Area | rsync | rclone | Lios direction |
| --- | --- | --- | --- |
| Copy vs mirror | One command; deletion is opt-in | `copy` non-deleting; `sync` deleting | rclone verb split |
| Source directory `/` | Directory itself vs contents | Always contents | rsync distinction |
| Remote profiles | Direct host/module operands | Named and ad-hoc remotes | Registered Space Name only |
| Two remote endpoints | Unsupported | Supported | Support Space-to-Space |
| Filter flag ordering | One ordered stream | Families regrouped | One explicit ordered stream |
| Excluded destination entries | Protected by default | Protected by default | Protected by default |
| Dry-run fidelity | Itemization intended to match | Predictive with limitations | Exact persisted Transfer Plan |
| `-P` | `--partial --progress` | `--progress` | Lios must choose |
| Usage-error exit code | `1` | `2` | Lios-native taxonomy |

## Precise follow-up decisions surfaced

1. For every source/destination type pair, what tree results from `source`
   versus `source/`, especially for a Space Path and Catalog Root?
2. Does one `copy` command handle single-file rename and nonexistent
   destination resolution, or is a separate explicit form needed?
3. What is the canonical ordered filter grammar, and are mixed convenience
   include/exclude flags preserved in command-line order or rejected?
4. Are excluded destination nodes always protected from `sync`, and will Lios
   expose a destructive `--delete-excluded` equivalent?
5. Which source, Catalog, and remote errors invalidate all planned deletes, and
   is any unsafe override allowed?
6. What does `-P` mean, if retained, and what are the default progress
   surfaces for TTY, `--json`, and `--detach`?
7. What stable symbolic and numeric exit taxonomy maps Durable Task states to
   foreground process completion?
8. For Space-to-Space work, which routing or optimization facts must be visible
   in the Transfer Plan and progress output?
