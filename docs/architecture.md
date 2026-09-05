# Architecture

Pilates Booker v0.2.2 is one independent command invocation. It parses validated CLI values, resolves one private runtime, acquires the exclusive profile lock, optionally initializes debug logging, inspects one Arketa checkout, optionally submits once, emits one schema-v2 result, and releases the lock.

## Component ownership

| Component | Owns |
| --- | --- |
| `command-arguments.ts` | Exact public options, strict checkout URL validation, package order, and platform runtime defaults |
| `command.ts` | Parse-failure boundary and fixed fallback diagnostic |
| `cli.ts` | Runtime paths, optional logger, lock lifecycle, in-memory execution stage, result validation, and stdout |
| `lock.ts` | Exclusive version-2 PID lock, conservative stale-owner recovery, single acquisition retry, and replacement-safe release checks |
| `booking-workflow.ts` | Existing-enrollment reconciliation, package authorization, dry run, preparation, one submission, and confirmation |
| `booking-page.ts` | Narrow supported main-frame/light-DOM observation and mutation boundary |
| `result-validator.ts` | Schema, mode, action, package, and calendar URL binding |
| `debug-log.ts` | Explicit field projection, serialized NDJSON append, restrictive modes, and one-generation rotation |

## Execution sequence

The command validates all caller input before browser work. It acquires the exclusive runtime lock before requested debug logging is initialized, so shared log initialization, append, and rotation remain serialized across invocations. Each stage transition is appended before execution continues. The allowed transition chain is `STARTING → VALIDATED → READY_TO_SUBMIT → SUBMITTING → CONFIRMED`.

A failure before `SUBMITTING` produces `TECHNICAL_FAILURE`; a failure at or after `SUBMITTING` produces `CONFIRMATION_UNCERTAIN`. The executor is never retried. Once stdout has accepted a complete result, a later diagnostic append failure cannot replace that response.

The runtime contains the reusable authenticated `Profile/`, an exclusive `run.lock`, and debug logs only when requested. A current lock contains strict version-2 metadata with only the positive safe-integer owner PID. There is no local transaction replay or durable enrollment record. Repeated invocations inspect Arketa again, and Arketa's existing-enrollment state prevents another enrollment action.

## Runtime-lock lifecycle

| Existing path | Evidence | Owning-boundary behavior |
| --- | --- | --- |
| Absent | None | Create the lock exclusively and write the current PID |
| Valid version-2 lock | PID probe succeeds, returns `EPERM`, or is otherwise indeterminate | Preserve the lock and stop |
| Valid version-2 lock | PID probe returns `ESRCH` | Re-read and revalidate the same PID and device/inode, remove the stale pathname, and retry exclusive acquisition once |
| Legacy, empty, partial, malformed, oversized, unreadable, or non-regular lock | Untrusted or unusable metadata | Preserve the path and require manual recovery |
| PID or device/inode changes during revalidation | Replacement evidence | Preserve the replacement and stop |
| Stale removal succeeds but the single retry loses | Concurrent winner | Preserve the winner and stop |

Only a conclusive absent-PID result authorizes stale-path removal. PID reuse, unreaped zombies, permission restrictions, and ambiguous probes can therefore preserve a stale lock. Portable Node filesystem APIs cannot atomically unlink an exact open inode; PID plus device/inode revalidation narrows but does not eliminate the final check/unlink race. The lock makes no process-start, boot-identity, hard-link, zombie-specific inspection, exact-inode deletion, or power-loss recovery guarantee.

## Result model

The only public result contract is schema version 2. It contains outcome/exit coherence, submission and confirmation booleans, safety checks, observed class and package evidence when applicable, optional same-class Google Calendar metadata, and fixed details. One compact object plus one newline is written to stdout.

See [Safety boundaries](safety-boundaries.md) for authorization, diagnostics, and explicit non-guarantees.
