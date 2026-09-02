# Safety boundaries

Pilates Booker is a reliable personal tool for a private, single-user runtime. It protects against realistic mistakes and ordinary failures while relying on Arketa for authoritative enrollment state and duplicate-enrollment prevention.

## Field and trust policy

| Data | Source and trust | Runtime use | Result/debug policy |
| --- | --- | --- | --- |
| Parsed options and booking URL | Caller; untrusted until strict parsing | Select checkout and behavior | Preserve validated values; reject invalid input |
| Runtime path | Caller or platform environment; untrusted until resolution | Select private profile, lock, and log locations | Preserve only the resolved absolute path; never derive paths from lock input |
| Allowed packages | Caller; validated and ordered | Authorize first eligible package | Preserve canonical safe text in preference order |
| Class/package observations | Arketa; constrained untrusted page text | Drive selection and result evidence | Preserve accepted printable text; never emit decoded inspection forms |
| Controls and confirmation | Arketa DOM | Authorize one click and classify confirmation | Emit fixed booleans/outcomes only |
| Runtime-lock PID | Current process or untrusted lock file | Write owner metadata and probe candidate-owner liveness | Accept only a positive safe integer; never return lock input, and project only allowlisted numeric process IDs in opt-in diagnostics |
| Raw lock content and parse errors | Local runtime; untrusted | Strict validation only | Exclude raw, escaped, encoded, and repeatedly encoded forms from results, diagnostics, exceptions, and logs; use a fixed lock-unavailable error |
| Exception diagnostics | Runtime/dependencies; untrusted | Failure classification | Debug-only printable projection with fixed credential/unsafe markers |
| Headers, cookies, tokens, storage, profile | Authentication secrets | Browser authentication | Excluded from results and logs |
| Attendee, injuries, form values | Private page state | Existing booking workflow | Excluded from results and logs |
| HTML, screenshots, traces | Bulk untrusted browser state | Not required | Excluded |

## Booking authorization

A live click requires one supported action permitted by the invocation, the uniquely selected `Myself` target, a non-empty injury field, accepted cancellation policy, and the first allowed active class package with a positive safe-integer balance. Positive approved balance is the supported no-charge evidence. Missing, disabled, duplicate, contradictory, or unsupported state stops before submission.

The caller selects the class by supplying its checkout URL. The application does not compare Arketa's displayed class to caller-provided date/time/name fields. It returns `observed_class` so the caller can verify the page that was processed.

## Submission and reconciliation

The coordinator enters `SUBMITTING` immediately before one exact permitted click and never retries automatically. Exact matching confirmation is required for submitted success. Existing booking or waitlist evidence is authoritative and causes no click.

If the process or output fails after submission, the result may be uncertain. Invoke the command again. Arketa, not a local log, reconciles whether enrollment already exists. The debug log is troubleshooting evidence and does not prove final enrollment.

## Diagnostic boundary

Debug logging is opt-in, bounded to a 1 MiB current file and one `.1` generation, and projected through an explicit allowlist. Raw, escaped, percent-encoded, and repeatedly encoded controls or recognizable credential material are replaced with fixed idempotent markers. Valid Unicode catalog text, the validated URL, filenames, and platform paths remain usable. Request/response headers are excluded except numeric status codes.

## Guarantees

- strict CLI and Arketa URL validation before browser work;
- private reusable browser profile and exclusive process lock;
- conservative PID-only recovery when a current lock's owner PID is conclusively absent;
- dry run without booking-field mutation or submission;
- deterministic ordered package preference and retained no-charge checks;
- at most one booking or waitlist click per invocation;
- exact confirmation or explicit uncertainty;
- one validated schema-v2 stdout object for reportable outcomes;
- opt-in bounded structured diagnostics with explicit sensitive-field exclusions;
- fail-closed handling of unsupported or ambiguous checkout structure.

## Explicit non-guarantees

The utility does not provide class discovery, scheduling, automatic login or booking retry, general stale-lock removal, alternate checkout structures, hostile same-account protection, power-loss durability, filesystem-corruption recovery, adversarial concurrent account access, screenshots, traces, HTML capture, or remote log shipping. Legacy, malformed, unreadable, active, indeterminate, replaced, and retry-race locks are preserved. PID reuse, an unreaped zombie, permission restrictions, or an ambiguous probe can cause false-active preservation and require manual removal. PID plus device/inode revalidation is not an atomic exact-inode deletion guarantee, and the utility does not inspect process-start identity, boot identity, or zombie state. It does not recover Chromium profile locks or use repeated speculative pre-click checks for page changes outside the supported stable-page model.
