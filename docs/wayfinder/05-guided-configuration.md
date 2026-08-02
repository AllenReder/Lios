# Guided configuration and first-transfer journey

This decision answers [issue #5](https://github.com/AllenReder/Lios/issues/5).
It is a target CLI contract, not an implementation of the current 0.2 commands.

## Decision

`lios config` is an interactive, reentrant orchestrator for one Lios Home. It
does not persist a wizard session, a second Space registry, or a guided-only
secret outside the normal Lios Home. The one intentional external secret copy
is the user-authorized Recovery Key backup destination. Each successful
configuration phase invokes one stable, composable command and makes one
atomic configuration mutation. Re-running `lios config` reads the actual Lios
Home, reports completed prerequisites, and continues at the first unfinished
phase.

Catalog initialization is a write exception to neither rule: `space init` and
the initialization half of `space create` create one inspectable, durable
**initialization Transfer Plan** and one Durable Task. The plan lists the
Catalog and required initialization-metadata writes, captures its empty-Catalog
baseline, and is persisted at the explicit initialization confirmation. The
Task Worker applies that exact plan. `config` only presents and orchestrates
this stable command; it does not invent a separate plan format. Repository
creation itself is an explicit remote configuration action. A Space Name is
registered only after its initialization Transfer Plan completes.

The guided flow is deliberately interactive. `--json` and `--no-input` reject
it before it prompts and direct automation to the corresponding stable
commands. Tokens are never accepted on argv or through an ordinary environment
variable.

## Guided flow

For a nondefault Lios Home, every automation command below uses the global
prefix `lios --home DIR`; omit that prefix only for the default Lios Home.
Every machine invocation also accepts `--json` and returns its normal one-
document JSON envelope.

| Phase | Guided choice and safety rule | Exact non-interactive invocation |
| --- | --- | --- |
| Lios Home | Select the default Lios Home or an explicit `--home DIR`, then initialize local state. Setup creates no Recovery Key. | `lios --home DIR setup` |
| Authentication | Enter a ModelScope Token. `auth login`, including `--token-stdin`, validates it with ModelScope before writing it. A failed validation does not create or overwrite credentials. | `secret-provider \| lios --home DIR auth login --token-stdin` |
| Recovery Key | Explicitly choose **create** or **import**. An imported candidate is verified before replacement. A created or imported key must be successfully copied to a user-selected backup destination before the flow can initialize, register, or write a Lios Space. | Create: `lios --home DIR key create` then `lios --home DIR key backup DEST`. Import: `lios --home DIR key verify PATH`, `lios --home DIR key import PATH`, then `lios --home DIR key backup DEST`. |
| Existing Lios Space | Choose a discovered Dataset Repository or enter a Repository Address manually. Discovery is convenience, not authority: manual entry supports organization and shared repositories. `space add` first opens the Catalog with the configured Recovery Key; only a valid Lios Space is registered. | Discover: `lios --home DIR space discover --endpoint ENDPOINT`. Register: `lios --home DIR space add NAME NAMESPACE/DATASET --endpoint ENDPOINT` |
| Empty repository | A Dataset Repository with no Lios Catalog is never initialized implicitly. The flow shows its address, renders the initialization Transfer Plan, requests an explicit confirmation, then initializes and registers it under the chosen Space Name. | `lios --home DIR space init NAME NAMESPACE/DATASET --endpoint ENDPOINT` |
| New Lios Space | Creating remote storage is an explicit branch. The flow shows the Endpoint, Namespace, Dataset Name, and 2–32-character lowercase Space Name, then requests confirmation before it creates the Dataset Repository, renders/confirms its initialization Transfer Plan, and registers the alias. | `lios --home DIR space create NAME --namespace NAMESPACE --dataset DATASET --endpoint ENDPOINT` |
| Handoff | After at least one Space Name is registered, show the completed Space and safe first-transfer examples. Do not browse local files or start a transfer from `config`. | `lios --home DIR space list`; then an explicit `lios --home DIR copy ...` chosen by the user |

`name:` and `name:/absolute/catalog/path` remain Space Paths. The Space Name
is local and may be renamed without changing the Repository Address or Lios
Space.

## First-transfer handoff

The completion screen gives copy-pasteable examples using the registered Space
Name, for example:

```text
lios copy ./Camera/ photos:/2026/ --progress
lios copy photos:/2026/ ./Restore/
lios copy photos:/2026/ archive:/2026/
lios task list
```

`config` does not guess a Local Location, select a Catalog path, or create a
user-file Transfer Plan. If it orchestrates `space init`, that command renders
and persists the initialization Transfer Plan described above. The user's first
file data-changing operation is an explicit `copy` or `sync` command and
follows the transfer safety contract.

## Failure, interruption, and recovery

- Every completed phase remains completed after the terminal exits. A failed
  phase leaves the previous authenticated token, Recovery Key binding, and
  Space registry untouched.
- A remote repository created before a later initialization-plan failure is
  visible on the next run. The flow reports its Repository Address and offers
  the explicit `space init` route; it never retries remote creation invisibly.
- Registering an existing Space never turns an arbitrary Dataset Repository
  into a Lios Space. Initialization is a separately confirmed action.
- Authentication, Recovery Key, and Space registry operations are atomic
  configuration mutations. They are not Transfer Plans and do not create
  Durable Tasks.
- Catalog initialization is not a configuration-mutation exception: it creates
  the initialization Transfer Plan and Durable Task before it can register the
  Space Name.
- CLI and Desktop observe the same Lios Home, credentials, Recovery Key,
  Space registry, task database, and Task Worker. The flow adds no guided-only
  state for Desktop to reconcile.

## Automation contract

Each guided phase has the exact non-interactive command shown above. Those
commands retain their stable JSON envelopes and non-interactive error behavior.
Because `config` is interactive, these invocations are defined precisely:

- `lios --json config` emits exactly one JSON error envelope on stdout and no
  prompt or progress, for example
  `{"schema_version":1,"ok":false,"command":"config","error":{"code":"interaction_required","message":"lios config is interactive; run the phase commands directly for automation"}}`,
  then exits with category `3` (no input/interaction required).
- `lios --no-input config` prints the same human explanation without prompting
  and exits with category `3`.
- `lios --json --no-input config` uses the same one-document JSON envelope and
  exit category `3`.

This avoids a hidden prompt or a second machine interface while preserving the
stable JSON and non-interactive contract.

## Consequences for the 0.2 surface

The target contract separates local-state setup from Recovery Key creation:
`setup` must no longer silently generate a key. `key create` is explicit, and
successful `key backup` is the prerequisite gate before the first Space is
initialized, registered, or written. The migration contract for this breaking
change is defined in issue #8.
