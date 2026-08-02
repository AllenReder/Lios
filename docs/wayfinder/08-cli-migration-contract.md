# Breaking migration from the Lios 0.2 CLI

This decision answers [issue #8](https://github.com/AllenReder/Lios/issues/8).
It is a target CLI migration contract, not an implementation of either CLI
surface. It settles the public release boundary for the decisions in issues
#3, #5, #6, and #7.

## Decision

Lios 0.3.0 is the breaking release that adopts the canonical CLI described by
this map. The pre-1.0 minor-version change is intentional: a 0.2 invocation
whose meaning could change from non-deleting to deleting must not acquire its
new meaning merely because a user replaced the executable.

The old 0.2 command surface and JSON schema version 1 end at that release.
The 0.3 target surface uses the long canonical command names from issue #3,
keeps its Unix short aliases where specified below, makes sync an exact mirror
of its resolved target subtree, and starts JSON at schema version 2. A package
upgrade, a worker restart, opening a Lios Home, and running setup must never
silently acknowledge that semantic change.

There is no automatic "try old syntax, then new syntax" mode. A command is
either an explicitly supported canonical spelling, a listed compatibility
spelling during its stated window, or an error that explains the replacement.
In particular, Lios must not inspect the presence or absence of --delete and
guess whether an otherwise identical sync invocation is an old non-deleting
script or a new mirror request.

## Lios Home command-contract detection

The durable command-contract marker is distinct from the configuration-file
schema version. A 0.2 Lios Home may already use a configuration schema that
the target CLI can parse, so configuration schema alone is not evidence that
the user accepted 0.3 sync semantics.

The shared-state migration design may choose the exact file or database record,
but it must expose one atomically written, per-Lios-Home command-contract
marker with these observable states:

| Detected state | Meaning | Target CLI behavior |
| --- | --- | --- |
| Fresh | No initialized Lios Home artifacts and no marker exist. | Setup or config initializes the canonical 0.3 marker as part of normal fresh setup. |
| Legacy-unacknowledged | A Lios Home artifact exists but no canonical marker exists. This includes every 0.2 Home. | Read-only inspection is available; all state mutations and transfers fail safely with cli_migration_required until migration is explicitly acknowledged. |
| Canonical-0.3 | The migration completed, or this was a fresh 0.3 Home. | The canonical commands and semantics apply. |
| Newer-than-client | The marker names a future contract generation. | The older CLI refuses to read or write mutable state with newer_cli_contract; it must not downgrade or rewrite the marker. |

Lios Home artifacts include the configuration, Space registry, Recovery Key
binding, task database, worker state, or an existing migration record. An empty
directory passed through --home is Fresh; an unreadable or partly corrupted
Home is not assumed Fresh and fails as a storage/operational error.

Before acknowledgement, --help, --version, status, auth status, key status,
space list/show, list, search, task list/show/wait, and migrate are safe
observers. Commands that would change configuration, a Catalog, a Content
Object, a Local Location, task state, or the Task Worker fail before planning,
prompting, creating a Durable Task, or starting remote work. This includes
copy, sync, move, delete, mkdir, task resume/retry/pause/cancel/clear, auth
login/logout, key create/import, setup, config, and every mutating space
command.

The required failure has exit category 3 and the machine error code
cli_migration_required. Its human message names the Home and directs the
operator to:

~~~
lios migrate --from=0.2 --check
lios migrate --from=0.2 --acknowledge-sync-mirror
~~~

The target CLI does not default a legacy Home into a compatibility execution
mode. That would make an old bare sync invocation ambiguous again.

A Newer-than-client marker is a different, stable failure. After parsing and
canonical alias resolution, the CLI returns exit category 1 and exactly this
schema-2 failure shape, with the actual canonical command name:

~~~
{
  "schema_version": 2,
  "ok": false,
  "command": "sync",
  "result": null,
  "error": {
    "code": "newer_cli_contract",
    "message": "this Lios Home was migrated by a newer Lios CLI"
  }
}
~~~

Only --help and --version, which do not open a Lios Home, remain available in
that state. All other apparent observers, including status, task list/show,
and migrate --check, stop after reading the minimal marker and before
deserializing configuration or task state. The older client never rewrites,
backs up, or downgrades a future Home.

## Explicit migration

Migration is a transitional top-level command:

~~~
lios migrate --from=0.2 --check
lios migrate --from=0.2 --acknowledge-sync-mirror
lios migrate --from=0.2 --acknowledge-sync-mirror --yes
~~~

Acknowledgement is valid only for a Legacy-unacknowledged Home. On a Fresh
Home, every migrate invocation returns migration_not_required (exit 2), makes
no marker or snapshot, and directs the user to setup or config. On a
Canonical-0.3 Home, --check and acknowledgement return a schema-2 success
result with changed: false and no worker handshake, snapshot, or write; this
makes an idempotent automation check possible without re-migrating state. On a
Newer-than-client Home, the newer_cli_contract category-1 failure above wins
before any migration preflight work.

--check is read-only. It reports the detected contract state, the registered
Space Names, whether a Recovery Key backup gate remains incomplete, the
presence of old task history, and every nonterminal Durable Task identifier.
It also prints the mandatory behavioral audit:

| 0.2 intent | 0.3 replacement |
| --- | --- |
| Source-wins update with no destination-only deletion: sync SOURCE DEST | copy SOURCE DEST |
| Exact source mirror including deletion: sync SOURCE DEST --delete --yes | sync SOURCE DEST --yes |

Lios cannot discover every script, shell history entry, or CI job on the
user's machine. The check therefore says so plainly and requires the operator
to review each use of sync before accepting mirror-by-default semantics.

The acknowledgement command performs this sequence:

1. Acquire an exclusive migration lease. If the Task Worker is running,
   migrate itself issues the same graceful stop request as worker stop and
   waits for a safe checkpoint before proceeding. This narrow internal
   handshake is the only worker-state exception to the legacy mutation gate;
   the standalone worker stop command remains gated. Migrate never kills a
   worker or interrupts a committing Catalog publication. If it cannot obtain
   the lease or the worker cannot reach a safe stopped state, it fails without
   changing the Home.
2. Refuse migration while any legacy Durable Task is planned, queued,
   preparing, running, retrying, paused, or committing. The operator must
   complete or cancel it with the 0.2 client before migration. Terminal legacy
   history remains readable but is never resumed or retried by the 0.3 worker.
3. Create a consistent, recoverable pre-migration snapshot of the mutable
   configuration/registry and task-state records before writing the marker.
   The migration aborts unchanged if it cannot make that snapshot. It does not
   copy a Recovery Key to a new destination or reveal token/key material.
4. Render the changed sync meaning, the command-name table below, and the
   Home that will become canonical. An interactive invocation requires a
   positive confirmation. Non-interactive use requires both the dedicated
   --acknowledge-sync-mirror flag and --yes; a generic --yes alone is never
   sufficient.
5. Atomically write the Canonical-0.3 marker and the state-version migration
   record. It queues no Durable Task, creates no Transfer Plan, and performs
   no Catalog, Content Object, Local Location, or remote mutation.

If a step fails, Lios leaves the Home Legacy-unacknowledged or restores the
previous atomic record; it never leaves a half-acknowledged Home. A completed
migration does not make an old 0.2 binary safe to run against that Home.
Release documentation tells users not to run 0.2 and 0.3 clients or workers
against one Home concurrently. The retained snapshot is recovery evidence,
not a supported in-place downgrade path after canonical work has begun.

Desktop observes the same marker and enforces the same gate. It must not offer
a GUI path that can create a transfer, change credentials, or acknowledge the
new sync semantics without the same migration confirmation.

## Command spellings and compatibility

The following aliases are part of the target public command grammar, not
temporary legacy support. They are documented in help and remain supported
indefinitely:

| Canonical command | Stable alias |
| --- | --- |
| list | ls |
| copy | cp |
| move | mv |
| delete | rm |

### Complete 0.2 surface map

This is the complete public 0.2 command inventory. A row marked "same" keeps
its spelling but still follows the target configuration, Transfer Plan,
Durable Task, interaction, and schema-2 contracts. The migration gate applies
to any row that would mutate a Legacy-unacknowledged Home.

| 0.2 form | Canonical 0.3 form or disposition | Compatibility/removal rule |
| --- | --- | --- |
| --home DIR | --home DIR | Same global Lios Home selector. |
| --json | --json with schema_version 2 | Same spelling; version 1 is never emitted by 0.3. |
| setup; status | setup; status | Same spellings. Setup no longer creates a Recovery Key and is migration-gated for a legacy Home; status remains a permitted observer. |
| auth login [--token-stdin]; auth status; auth logout | Same | Same spellings; login/logout remain gated until migration. |
| key status; key backup DEST; key verify PATH; key import PATH | Same, plus key create | Same spellings; key create is additive. Import/create and subsequent Space writes follow the explicit backup gate from issue #5. |
| space create; space init; space add; space discover; space list; space show; space rename | Same | Same registered-Space grammar and Repository Address validation. All mutators are migration-gated. |
| space remove NAME [--force] | space unregister NAME | The command-name alias is temporary; --force is removed at 0.3.0 with legacy_option_removed (exit 2), no mutation, and a human error naming the canonical unregister command. The alias's 0.3.x warning and 0.4.0 removal are below. |
| ls SPACE_PATH [--long] | list SPACE_PATH [--long], with ls permanent | The long name becomes canonical; ls is a permanent Unix alias, not a deprecation. |
| search SPACE_PATH QUERY; mkdir SPACE_PATH... [--parents] | Same | Same operands; mkdir remains a Catalog write and therefore follows the target Transfer Plan rules. |
| cp SOURCE... DESTINATION | copy SOURCE... DESTINATION, with cp permanent | The long name becomes canonical; cp is permanent. The target additionally accepts Space Path to Space Path. |
| cp --no-clobber; --replace-type; --yes; --dry-run; --detach; --progress | Same spellings | They use the target immutable-plan, planned-task, confirmation, observer, and progress rules from issues #6/#7. |
| cp --interactive | No canonical option | Rejected at 0.3.0 with legacy_option_removed (exit 2); inspect one action list and use filters or --no-clobber instead of per-item answers. |
| sync SOURCE DESTINATION [--delete] | sync SOURCE DESTINATION | Bare sync is the explicitly acknowledged exact mirror. --delete has the transitional rule below; --exclude and --exclude-from remain convenience filter spellings under issue #6. |
| sync --exclude/--exclude-from; --replace-type; --yes; --dry-run; --detach; --progress | Same spellings, with canonical --filter/--include additions | Existing convenience spellings retain their ordered-filter meaning; all other flags use the target plan/task rules. |
| mv SOURCE DESTINATION [--replace] | move SOURCE DESTINATION, with mv permanent | The target is a single-Lios-Space Catalog Node move; cross-Space work is copy then explicit delete. The old --replace option is rejected at 0.3.0 with legacy_option_removed (exit 2), because canonical move never overwrites a same-type target. |
| rm SPACE_PATH... --recursive | delete SPACE_PATH... --recursive, with rm permanent | The target long name is canonical; rm remains permanent. |
| rm --yes; rm --dry-run | Same spellings | They use the target action-list confirmation and planned-task rules. |
| verify SPACE: [--full] | verify SPACE_NAME [--full] | The target takes a Space Name rather than a root Space Path. A supplied old root operand receives invalid_input (exit 2) with this replacement; it is never silently normalized. |
| task list/show/wait/pause/resume/retry/cancel/clear | Same spellings | Task control/state meanings are the issue #7 contract. Legacy nonterminal tasks must finish/cancel before migration and are never reinterpreted. |
| worker status; worker stop | Same spellings | Same public controls after migration. During migration only migrate's internal graceful-stop handshake is allowed. |
| --no-input; --quiet; canonical --filter/--include spellings | New target options | They have no 0.2 compatibility interpretation; help documents their target behavior. |

The pre-0.2 forms removed by 0.2 are deliberately not reintroduced. They are
all hard errors beginning in 0.3.0, with error code legacy_command_removed,
exit 2, no plan/task, and these exact replacements:

| Removed form | Required target replacement |
| --- | --- |
| upload --parent NODE_ID PATH... | copy LOCAL_LOCATION... SPACE_PATH; find the intended Space Path with list/search first. |
| download --output DIR NODE_ID... | copy SPACE_PATH... LOCAL_LOCATION; resolve each node identifier to a Space Path first. |
| delete NODE_ID... | delete SPACE_PATH...; a node identifier is never interpreted as a Space Path. |
| rename NODE_ID NEW_NAME | move SOURCE_SPACE_PATH DESTINATION_SPACE_PATH in one Lios Space. |
| repos list | space discover for Dataset Repository discovery, or space list for registered Space Names. |
| space open --namespace N --dataset D | space add NAME N/D for a valid Lios Space, or space init NAME N/D after explicit initialization confirmation for an empty Dataset Repository. |

The transition handling is deliberately narrower:

| 0.2 spelling or behavior | 0.3.0 through 0.3.x behavior | 0.4.0 and later |
| --- | --- | --- |
| space remove NAME | Accepted as an alias for space unregister NAME. It emits deprecated_command with the canonical replacement and follows the canonical confirmation rules. | Rejected with legacy_command_removed, exit 2, and no mutation. |
| sync SOURCE DEST --delete | Accepted as a redundant option only after the Home is Canonical-0.3. Sync still renders the exact mirror plan and needs its normal confirmation or --yes. It emits deprecated_option. | Rejected with legacy_option_removed, exit 2, and no plan, task, or transfer. |
| sync SOURCE DEST without --delete | On a Legacy-unacknowledged Home, rejected with cli_migration_required before any planning. After explicit migration, it is canonical sync: exact mirror within the displayed resolved target subtree. | Same canonical behavior. |
| A 0.2 script whose bare sync was intended to preserve destination-only entries | It must be rewritten to copy with the equivalent operands and filters. There is no --no-delete compatibility switch for canonical sync. | Same. |
| setup expecting implicit Recovery Key generation | Setup only initializes the Lios Home. The migration output directs users to key create or key import and key backup; the first Space registration or write remains gated by the configuration contract from issue #5. | Same. |
| 0.2-only direction restriction | Space Path to Space Path copy and sync are additive target capabilities; no compatibility mode is involved. | Same. |

The temporary --delete spelling is not an opt-in for a different operation and
does not restore 0.2 non-deleting sync. It is allowed only because a 0.2 caller
that supplied it had already explicitly requested deletion. A successful
transitional invocation therefore has the same confirmed ordered action list
as the corresponding canonical sync; the warning is the only compatibility
effect.

Human-mode temporary aliases print one concise warning on stderr before any
action-list confirmation. The warning names the canonical spelling and the
removal release. It never prints a warning as a separate JSON document.

## Sync safety at the release boundary

Canonical sync is defined by issue #6: it is an exact source mirror only
inside its displayed resolved destination subtree, exclusions protect their
matching destination paths, and all create/update/delete/type-change actions
are inspected and confirmed as one immutable action list. A Catalog or Content
Object write becomes a Transfer Plan only at that confirmation; a Space Path
to Local Location transfer remains an immutable Durable Task action list.

The migration boundary adds these non-negotiable protections:

- An unacknowledged 0.2 Home cannot execute bare sync, even with --yes,
  --detach, --dry-run, --json, or --no-input. Its response is the migration
  error, not a best-effort plan under either semantic.
- Canonical sync on a TTY renders its delete actions and asks for confirmation.
  Non-interactive callers must use --yes; --json and --no-input never
  manufacture a confirmation.
- The --delete compatibility spelling never bypasses a confirmation, widens
  the resolved subtree, changes filter protection, or lets the worker re-plan.
- A legacy planned/nonterminal task blocks migration rather than being
  reinterpreted by a new worker. A canonical planned task keeps the immutable
  dry-run/resume semantics from issue #7.
- Source-read failures, stale baselines, rejected type changes, excluded
  paths, and declined confirmations retain all deletion suppressions specified
  in issue #6. Migration itself introduces no delete action.

Thus a user can choose to accept a breaking mirror default, but their
pre-existing executable, Lios Home, or script is never silently converted into
one.

## JSON protocol and exits

The 0.2 JSON envelope with schema_version 1 remains the protocol for a 0.2
binary. It is not emitted by 0.3, and 0.3 provides no flag that silently
pretends its different task, command, warning, or exit semantics are version
1. Automation must branch on schema_version and fail closed on an unknown
version.

The target envelope described in issue #7 is therefore schema_version 2 at
this release boundary. This intentionally renumbers the illustrative
schema-version-1 JSON in issues #3, #5, and #7; it also applies issue #7's
full result-or-error shape to the configuration error shown in issue #5. It
does not change their one-document, task, signal, or exit-category rules. The
version bump is required because 0.2 command names, result shapes, task
lifecycle, and exit meanings are not the same machine contract.

Every 0.3 --json response is exactly one UTF-8 object plus a newline on
stdout. Its command field contains the canonical command name after alias
resolution. It has no human warning or progress on stderr. A successful
temporary compatibility spelling adds a machine-readable warnings array:

~~~
{
  "schema_version": 2,
  "ok": true,
  "command": "sync",
  "result": { "waited": false, "task": { "id": "..." } },
  "warnings": [
    {
      "code": "deprecated_option",
      "option": "--delete",
      "replacement": "remove --delete; sync already mirrors",
      "removal_version": "0.4.0"
    }
  ]
}
~~~

A Legacy-unacknowledged transfer returns no partial result and no task:

~~~
{
  "schema_version": 2,
  "ok": false,
  "command": "sync",
  "result": null,
  "error": {
    "code": "cli_migration_required",
    "message": "this Lios Home must explicitly acknowledge 0.3 mirror sync semantics"
  }
}
~~~

Migration status and successful migration results include changed, from, and
to fields but no ModelScope Token or Recovery Key material. Removed aliases
use their stable error codes above and exit 2. Migration acknowledgement that
needs or lacks confirmation uses the interaction category, exit 3. All other
exit meanings remain the target categories from issue #7: 0 success, 1
operational, 2 usage/input, 3 interaction, 4 authentication/authorization, 5
conflict/stale baseline, and 130 interruption.

Within schema version 2, additive fields are permitted. Field removal,
meaning/enum changes, or a changed exit-category meaning requires a later
schema version. The migration helper remains available through 1.0.0 so a
user may jump from a retained 0.2 Home; its eventual removal requires a new,
separately documented migration decision.

## Release communication and implementation acceptance

The 0.3.0 release notes, package-manager upgrade notes, top-level help, sync
help, copy help, migrate help, and Desktop migration screen must all contain
the same short statement:

> Lios 0.3 makes sync an exact mirror. An existing 0.2 Lios Home is
> read-only until you review and explicitly acknowledge that change. Use copy
> for the former non-deleting sync intent.

The migration guide must include before/after commands, the exact command
table above, the task-worker shutdown/preflight sequence, the Recovery Key
backup reminder, JSON schema 2 examples, the 0.4.0 removal date, and a
rollback warning. Installers may display that guide, but must not execute
migrate or edit a Home as an installation side effect.

An implementation is not ready until tests demonstrate all of the following:

1. A populated unmarked 0.2 Home rejects every mutator, including each sync
   mode, before it creates a plan/task or contacts remote storage.
2. Fresh Homes become canonical only through fresh setup/config; newer markers
   fail without overwrite; malformed Homes never fall through to Fresh.
3. Migration is lease-protected, rejects a live worker/nonterminal legacy
   task, makes a recoverable snapshot, requires the dedicated acknowledgement,
   and changes no Catalog, Content Object, Local Location, or remote state.
4. A post-migration bare sync produces the normal exact-mirror action list,
   while the equivalent former non-deleting intent uses copy.
5. The 0.3.x --delete compatibility spelling has no semantic bypass and emits
   exactly one human or JSON warning; the 0.4.0 parser rejects it before
   planning.
6. Permanent Unix aliases keep their canonical command identity; temporary
   aliases and pre-0.2 command forms follow the stated warning/error paths.
7. Version-1 and version-2 JSON consumers can distinguish the release
   boundary, and all schema-2 responses remain one parseable document with
   the defined exit category.

## Consequences

This migration deliberately favors an explicit one-time acknowledgement over
transparent upgrade convenience. It preserves the canonical simplicity of
mirror-by-default sync after the boundary while making the one ambiguous old
command safe before the boundary. It also leaves the exact shared-state
storage layout, task-record migration mechanics, final help wording, and
end-to-end documentation details for the subsequent specification and ticket
phases.
