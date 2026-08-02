# Foreground, detached task, progress, and automation contract

This decision answers [issue #7](https://github.com/AllenReder/Lios/issues/7).
It is a target CLI contract, not an implementation of the current 0.2 commands.

## Core decision

One **Task Worker** owns task scheduling and execution for one Lios Home. CLI
and Desktop submit commands to that worker and observe the same persisted
**Durable Task** records; neither client executes a separate foreground copy of
a task. A command's foreground or detached behavior changes only its observer
attachment, never the task, action list, Transfer Plan, retry policy, or
worker.

After a transfer command has rendered and confirmed the action list described
in [issue #6](https://github.com/AllenReder/Lios/issues/6), Lios atomically
persists the task and asks the Task Worker to schedule it:

- Default foreground behavior attaches the CLI to that task and waits.
- `--detach` submits the same task, prints its Durable Task identifier, and
  exits without an observer attachment. It does not start a different job.
- `task wait ID` attaches to an existing task; it never reruns or reconstructs
  it.
- `task resume ID` and `task retry ID` attach and wait by default after their
  state transition. They accept `--detach` to return after acceptance instead.

Where a confirmed action list changes a Catalog or Content Object, it is the
immutable Transfer Plan defined in `CONTEXT.md`. A Space Path → Local Location
operation has the same immutable Durable Task action list but is not a
Transfer Plan. Both kinds have identical foreground, detachment, checkpoint,
and observation rules.

The worker uses an exclusive per-Lios-Home lease and is the only process that
may claim, transition, or execute a task. It may schedule compatible work, but
it serializes Catalog mutation for each Lios Space. A CLI or Desktop client may
start or connect to the worker; failure to do so leaves an already persisted
task `queued`, returns its identifier, and reports `worker_unavailable` as an
operational failure. A client must never fall back to executing it itself.

## Durable Task lifecycle

Task state strings in the target JSON contract are lowercase. `phase` gives
more specific work such as `preparing`, `transferring`, `verifying`, or
`committing`; it is not a second state machine.

| State | Meaning | Allowed next states / controls |
| --- | --- | --- |
| `planned` | `--dry-run` persisted an unconfirmed action list and its baselines. No source or destination write has occurred and there is no Transfer Plan yet. | `task resume ID` renders the same list and requires its normal confirmation (`--yes` for automation); then `queued`. `task cancel` → `canceled`. |
| `queued` | A confirmed action list is durable and awaiting the Task Worker. For a Catalog or Content Object write, it is now a Transfer Plan. | Worker → `preparing`; `task pause` → `paused`; `task cancel` → `canceled`. |
| `preparing` | The worker validates the saved baselines and stages safe prerequisites. | `running`, `retrying`, `paused`, `failed`, or `canceled`. |
| `running` | The worker is applying non-final actions and recording checkpoints. | `retrying`, `paused`, `committing`, `failed`, or `canceled`. |
| `retrying` | A retryable remote or local-I/O failure is waiting for its bounded backoff. The saved action list is unchanged. | `preparing` or `running`; `paused`, `failed`, or `canceled`. |
| `paused` | No action is in flight. All completed checkpoints remain durable. | `task resume` → `queued`; `task cancel` → `canceled`. |
| `committing` | A Catalog publication or equivalent final atomic step is in progress. | `completed` or `failed` after reconciliation. Pause and cancel are rejected; they must not interrupt an atomic commit. |
| `failed` | A terminal failed attempt with a stable error code and retryability flag. | Only `task retry` on a retryable failure → `queued`; stale, invalid, and source-mutation failures require a new command. |
| `completed` | The exact action list completed. | Terminal; `task show` and `task wait` only. |
| `canceled` | The worker observed an accepted cancellation at a safe checkpoint, or a planned/queued task was canceled before work began. | Terminal; a new command is required. |

`task pause` records a pause request first and the worker completes the current
safe checkpoint before it enters `paused`. `task cancel` similarly records a
cancellation request for `preparing`, `running`, or `retrying`; it never rolls
back completed Local Location changes by guesswork and never exposes a partial
Catalog publication. `task pause` and `task cancel` return after their request
is durably accepted, not after the task reaches its requested state.

The Task Worker performs at most three automatic retries for a retryable
transport or local-I/O failure, after 1, 5, and 30 seconds respectively. A
server retry-after may lengthen, but never shorten, that delay. The task enters
`failed` with `can_retry: true` when that budget is exhausted. A manual `task
retry` repeats the same action list, saved baseline validation, and checkpoint
rules; it never re-plans. `stale_plan`, `source_unreadable`, invalid input, and
conflict failures are not automatically retried.

After an unclean worker exit, `planned` and `paused` tasks retain their state.
The next worker revalidates a previously `preparing`, `running`, or `retrying`
task against its saved baselines and checkpoints before requeueing it. A task
interrupted in `committing` reconciles its final Catalog checkpoint first: it
becomes `completed`, is replayed without a new action list or Transfer Plan, or
fails with a conflict. No recovery path silently scans fresh source trees or
adds deletes.

## Task commands and control boundaries

| Command | Contract |
| --- | --- |
| `task list` | Lists summaries from the Lios Home's shared task database. It does not contact a different client-local queue. |
| `task show ID` | Returns the current durable summary, immutable action-list/Transfer-Plan identity, failure data, and a paged item/checkpoint view. |
| `task wait ID` | Observes an existing task until `completed`, `failed`, or `canceled`. If it is `planned` or another client leaves it `paused`, `wait` returns that current state rather than waiting forever. |
| `task pause ID` | Requests a safe pause for a queued, preparing, running, or retrying task. `planned` is not paused; it may be canceled or resumed for confirmation. `committing` and terminal states are rejected. |
| `task resume ID` | Confirms a `planned` action list or requeues a `paused` task. It waits by default, or detaches with `--detach`. It is not retry. |
| `task retry ID` | Requeues only a retryable `failed` task with the same action list. It waits by default, or detaches with `--detach`. |
| `task cancel ID` | Requests cancellation for a nonterminal task. It never rewrites a completed action list and cannot interrupt `committing`. |
| `task clear ID...` | Removes only explicitly selected terminal Lios Home task history after `--yes`; it never deletes Catalog Nodes, Content Objects, or Local Location data. |
| `worker status` / `worker stop` | Shows the per-Lios-Home worker and requests graceful stop. Stop stops accepting new claims and waits for a safe checkpoint; it never kills an in-progress `committing` state. |

These control commands use compare-and-set state transitions in the worker.
Their response includes the current state and a `changed` boolean, so a racing
CLI and Desktop command cannot imply a transition that did not happen. An
idempotent repeat of an already requested nonterminal control is a successful
no-op; an unknown task identifier, a different incompatible state transition,
or incompatible options is an input error. A request rejected because a task
is committing is a conflict.

`task wait` returning `planned` or `paused` is an observed non-completion: it
uses exit `1` and `error.code: "task_not_running"`, with the Durable Task
identifier in `error.task_id`. `task show ID` returns the full snapshot before
the caller decides whether to confirm/resume it.

## Foreground waiting, detachment, and Ctrl-C

A foreground CLI is only an observer. It renders and confirms the action list
(and its Transfer Plan when applicable) before submission, attaches to the
Durable Task after the worker accepts it, and exits based on that same task's
outcome. Desktop can attach, pause, cancel, or observe the task while the CLI
waits; the CLI must display the resulting shared state rather than treating it
as a private foreground run.

`--detach` remains subject to the normal action-list confirmation gate. In a
TTY it may prompt; in automation the caller uses `--yes --detach`. On success
its normal result identifies `queued` (or a later state if the worker claimed
it quickly), with `waited: false`. A zero exit code means the task and its
action list were accepted durably; it does not mean its data transfer
completed.

`--detach` and `--dry-run` are mutually exclusive and their combination is a
usage error (exit `2`): a dry run already returns an inert `planned` Durable
Task. This does not prohibit `task resume ID --detach`, which confirms that
already-persisted action list and then detaches from its execution.

For a foreground task after confirmation, one Ctrl-C detaches the CLI observer,
prints or returns the Durable Task identifier, and exits `130`. It does not
pause or cancel the worker. A Ctrl-C while a not-yet-persisted unconfirmed
action list is displayed discards it and exits `130`; there is no task to
resume. In contrast, a Ctrl-C or declined confirmation during `task resume ID`
for a persisted `planned` task leaves that task, its baselines, and its
identifier unchanged in `planned`; it exits `130` or category `3` respectively.
For `--json`, an interruption produces the one JSON error envelope with
`error.code: "interrupted"` and the task identifier when one exists. To stop
work, users explicitly invoke `task pause ID` or `task cancel ID`.

## Human terminal progress

Human progress is an observer view, not a control channel. In a foreground TTY
without `--json` or `--quiet`, `--progress` enables a single redrawable status
line on stderr. It includes the Durable Task identifier, state/phase,
items-complete/total, bytes-complete/total, speed, and ETA when known. It
redraws no more than four times per second, while state changes and the final
outcome render immediately. It never claims completion before a final
`completed` state and finishes with a newline. `committing` explicitly reports
that the final Catalog publication is in progress.

Without `--progress`, a foreground TTY receives the action list, a concise
start line, and a final task outcome but no redraw. A non-TTY never receives
terminal progress. `--progress` with a non-TTY, `--json`, or `--quiet` is a
usage error rather than a stream of ambiguous carriage returns. `--progress`
with `--detach` is likewise a usage error because no foreground observer is
attached. Ordinary human results go to stdout; progress and warnings go to
stderr; human errors go to stderr.

Progress samples may be coalesced, but their durable `revision` is monotonic.
Within one attempt, completed item and byte counts never decrease. A new retry
increments `attempt`; a client uses `(attempt, revision)`, not terminal text,
to recognize a new progress interval.

## Non-TTY, JSON, and stable exits

`--json` emits exactly one UTF-8 JSON document followed by a newline on stdout
and emits no progress or ordinary human diagnostics. It also implies no input:
a command needing confirmation without `--yes` returns the interaction
category. `--no-input` has the same no-prompt behavior with human output.
Neither option creates a second task protocol; automation uses `task show`,
`task wait`, or `task list` to observe the same Durable Task.

The version-1 envelope is stable:

```json
{
  "schema_version": 1,
  "ok": true,
  "command": "sync",
  "result": {
    "waited": true,
    "task": {
      "id": "018f5dbe-7dd8-7a30-8d52-5fb732731345",
      "state": "completed",
      "phase": null,
      "revision": 17,
      "attempt": 1,
      "created_at": "2026-08-02T14:00:00Z",
      "updated_at": "2026-08-02T14:01:11Z",
      "transfer_plan_id": "plan_…",
      "can_retry": false,
      "progress": {
        "items_done": 12,
        "items_total": 12,
        "bytes_done": 8388608,
        "bytes_total": 8388608,
        "speed_bps": 1048576,
        "eta_seconds": null
      }
    }
  }
}
```

`transfer_plan_id` is `null` for every `planned` task and for every Space Path
→ Local Location task. It is non-null only after a confirmed Catalog or Content
Object write has become a Transfer Plan. Timestamps are RFC 3339 strings; known
byte and count fields are JSON integers; unknown totals and ETA are `null`.
`task list` returns the same task shape in a `tasks` array with a nullable
`next_cursor`; `task show` may add a paged `items` result. Additive fields are
allowed within a schema version, but field removal, meaning changes, or enum
spelling changes require a new schema version.

For `task pause`, `task cancel`, `task resume`, and `task retry`, `result`
always has `changed` and `task` fields. `changed` is true only when this request
performed the durable transition; a racing request that observes the already
desired nonterminal state returns `changed: false` and the current task shape.
`task resume` and `task retry` additionally return `waited`, using the same
foreground/detached rule as a transfer command.

Failures before a task is accepted use the companion shape:

```json
{
  "schema_version": 1,
  "ok": false,
  "command": "sync",
  "result": null,
  "error": {
    "code": "stale_plan",
    "message": "the confirmed baseline changed",
    "task_id": "018f5dbe-7dd8-7a30-8d52-5fb732731345"
  }
}
```

If a command accepted or controlled a task and then waited for it to fail, the
envelope keeps the accepted task result instead of replacing it with `null`.
It sets `ok: false`, retains `waited: true` and the final task shape in
`result.task`, and supplies the final task error in `error`. A foreground
`task resume` or `task retry` also retains `result.changed`; for example, its
result has `changed: true`, `waited: true`, and the final `failed` task. This
lets automation distinguish a successful durable control transition from the
later failed task outcome without parsing prose.

`error.code`, task state, and exit category are machine contracts; callers
must not branch on `message`. Envelopes never contain a ModelScope Token,
Recovery Key, or worker-internal secret.

| Exit | Meaning | Examples |
| --- | --- | --- |
| `0` | The requested action succeeded. A detached task was accepted; a foreground/waiting task completed; a control request was accepted. | `copy --yes --detach`, `task cancel ID`, `task wait ID` after completion. |
| `1` | Operational failure. | Worker unavailable, exhausted retryable network/local-I/O failure, or an observed canceled/paused task. |
| `2` | Usage or input failure. | Invalid operands, unknown task identifier, incompatible flags, or an invalid state transition. |
| `3` | Interaction was declined or required but unavailable. | A declined action list, `--json sync` without `--yes`, or `task resume` of a planned task without confirmation. |
| `4` | Authentication or authorization failure. | Missing/invalid ModelScope Token or remote authorization denial. |
| `5` | Conflict or stale baseline. | `stale_plan`, a Catalog conflict, an unreplaceable type conflict, or pause/cancel during `committing`. |
| `130` | This CLI process received an interrupt. | Foreground Ctrl-C detaches a task; Ctrl-C dismisses an unconfirmed action list. |

If a task later fails, a foreground command and `task wait` use the task's
recorded category. A detached submission has already returned `0`; automation
must inspect or wait on its identifier to learn the final transfer outcome.

## Desktop and shared-state observation

The Task Worker persists every state/control transition, terminal error,
attempt, checkpoint summary, and monotonic revision in the Lios Home's task
database. It publishes the same revisioned snapshots to connected CLI and
Desktop observers. Desktop must not create a parallel runner, substitute a new
Transfer Plan, or infer completion from a vanished CLI process.

Consequently, a task submitted by Desktop can be waited on by CLI, a task
detached by CLI remains visible in Desktop, and a Desktop cancellation is
reported by a waiting CLI as the shared `canceled` state. All observers may
disconnect without affecting execution. The worker lock, task database,
Recovery Key binding, and Space registry remain one per Lios Home.

## Consequences

The current foreground-only runner and ad hoc progress printer are replaced by
one worker-backed observation protocol. This decision defines target task
states, output envelopes, exit categories, and signal behavior; the breaking
command/state migration and compatibility period are defined in issue #8.
