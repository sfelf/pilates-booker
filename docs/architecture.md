# Architecture

Pilates Booker v0.2.0 is one independent command invocation. It parses validated CLI values, resolves one private runtime, optionally initializes debug logging, acquires the exclusive profile lock, inspects one Arketa checkout, optionally submits once, emits one schema-v2 result, and releases the lock.

## Component ownership

| Component | Owns |
| --- | --- |
| `command-arguments.ts` | Exact public options, strict checkout URL validation, package order, and platform runtime defaults |
| `command.ts` | Parse-failure boundary and fixed fallback diagnostic |
| `cli.ts` | Runtime paths, optional logger, lock lifecycle, in-memory execution stage, result validation, and stdout |
| `booking-workflow.ts` | Existing-enrollment reconciliation, package authorization, dry run, preparation, one submission, and confirmation |
| `booking-page.ts` | Narrow supported main-frame/light-DOM observation and mutation boundary |
| `result-validator.ts` | Schema, mode, action, package, and calendar URL binding |
| `debug-log.ts` | Explicit field projection, serialized NDJSON append, restrictive modes, and one-generation rotation |

## Execution sequence

The command validates all caller input before browser work. Requested debug logging initializes before lock acquisition, and each stage transition is appended before execution continues. The allowed transition chain is `STARTING → VALIDATED → READY_TO_SUBMIT → SUBMITTING → CONFIRMED`.

A failure before `SUBMITTING` produces `TECHNICAL_FAILURE`; a failure at or after `SUBMITTING` produces `CONFIRMATION_UNCERTAIN`. The executor is never retried. Once stdout has accepted a complete result, a later diagnostic append failure cannot replace that response.

The runtime contains the reusable authenticated `Profile/`, an exclusive `run.lock` only while active, and debug logs only when requested. There is no local transaction replay or durable enrollment record. Repeated invocations inspect Arketa again, and Arketa's existing-enrollment state prevents another enrollment action.

## Result model

The only public result contract is schema version 2. It contains outcome/exit coherence, submission and confirmation booleans, safety checks, observed class and package evidence when applicable, optional same-class Google Calendar metadata, and fixed details. One compact object plus one newline is written to stdout.

See [Safety boundaries](safety-boundaries.md) for authorization, diagnostics, and explicit non-guarantees.
