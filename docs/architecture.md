# Architecture

Pilates Booker is a local command-line transaction boundary around one supported Arketa checkout. An external caller chooses the checkout and supplies a versioned request. Pilates Booker validates that request and a separately stored policy, inspects the checkout through a dedicated browser profile, and either stops without submitting or performs one authorized booking or waitlist click.

The application does not discover classes, schedule itself, manage login, or report results to another service. Its machine-readable interface is the finalized result JSON written to stdout and to the private runtime directory.

## Components

| Component                     | Responsibility                                                                                                              | Does not own                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Command entry point           | Parses `--runtime`, `--policy`, and the request path; maps the final outcome to an exit code                                | Request semantics, browser decisions, or recovery rules                |
| Request and policy validation | Enforces versioned schemas, semantic restrictions, URL rules, timezone support, and explicit authorization                  | Page-derived facts                                                     |
| Runtime paths and lock        | Derives private paths and prevents overlapping use of the shared browser profile                                            | Automatic stale-lock removal                                           |
| Runtime coordinator           | Owns monotonic journal transitions, recovery classification, result finalization, and exact-byte replay                     | Browser selectors or package policy                                    |
| Browser session               | Opens and closes one persistent Chromium context using the dedicated profile                                                | Login, MFA, CAPTCHA, screenshots, traces, or storage export            |
| Checkout reader               | Produces one logical observation of the supported main-frame, light-DOM checkout under the page-stability operating model   | Booking authorization decisions                                        |
| Package selection             | Matches normalized page package names against policy order and selects the first approved positive balance                  | Payment-page interpretation                                            |
| Booking workflow              | Applies authorized fields, performs the final logical authorization read, submits at most once, and interprets confirmation | Persistence mechanics or stdout transport                              |
| Result validation             | Rejects outcome, request, policy, journal, package, and calendar-link contradictions at publication or recovery boundaries  | Reinterpreting a completed transaction using a later request or policy |
| Result output                 | Writes the exact finalized bytes once to stdout and reports only fixed diagnostics on failure                               | Retrying a transaction or regenerating a finalized result              |

## End-to-end data flow

1. The caller invokes the compiled command with a private runtime directory, an explicit policy file, and a request file.
2. The command parses and validates the request and policy before any browser is opened. The policy version must match the request.
3. The runtime boundary acquires the shared lock and examines request-scoped journal and result files.
4. A coherent finalized result for the same UUID is replayed byte-for-byte without opening the browser. An incomplete journal is classified from its persisted state without reinterpreting it through changed request or policy contents.
5. A new transaction advances from `INITIALIZED` to `VALIDATED` and invokes the booking workflow.
6. The browser opens the dedicated persistent profile, completes initial navigation, verifies that navigation ended at the requested supported checkout, and reads the page. Ambiguous controls, unsupported structure, authentication loss, or contradictory observations stop safely. Later navigation is outside the stable-page operating model; the workflow does not repeatedly recheck the URL.
7. A dry run returns trustworthy observations without changing booking fields or submitting. Reading existing enrollment may expand `View Details` to reveal authoritative confirmation evidence.
8. A live run detects existing enrollment or prepares the checkout: `Myself`, a non-empty injuries response, the selected approved package, and accepted cancellation.
9. The workflow performs one final logical authorization read. It reads live facts sequentially and assumes the supported page remains stable throughout that read and until the click. If every required fact matches, the coordinator records readiness and submission state immediately before the exact permitted action is clicked once.
10. After the click, only the matching authoritative Arketa confirmation is inspected. Optional Google Calendar metadata may hydrate within the same confirmation deadline.
11. The coordinator validates and atomically finalizes compact result JSON. The command writes those exact stored bytes, including the trailing newline, once to stdout.
12. The browser and lock are released on controlled outcomes. Diagnostics, when needed, use fixed text on stderr.

## State model

The journal is monotonic:

```text
INITIALIZED -> VALIDATED -> READY_TO_SUBMIT -> SUBMITTING -> CONFIRMED
```

Transitions cannot skip forward, move backward, or repeat a submission attempt. `READY_TO_SUBMIT` means the final logical authorization read passed under the page-stability operating model. `SUBMITTING` is recorded immediately before the single bounded click attempt. `CONFIRMED` means the matching authoritative Arketa confirmation was returned to the workflow.

The journal is local recovery evidence, not a distributed transaction log. A process exit after `SUBMITTING` can leave the external enrollment successful while the journal lacks `CONFIRMED`; recovery therefore reports uncertainty rather than guessing or clicking again.

Invalid combinations fail at the boundary that owns the relevant evidence:

| Invalid combination                                                                                    | Owning boundary                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Skipped, repeated, or regressed journal transition                                                     | Runtime coordinator                        |
| Submitted outcome with a pre-submission journal                                                        | Runtime coordinator and recovery validator |
| Confirmed journal with a pre-submission failure outcome                                                | Runtime coordinator and recovery validator |
| Dry-run request with a submitted or uncertainty outcome                                                | Fresh result validator                     |
| Selected package absent from positive approved inventory                                               | Package and result validators              |
| Approved positive inventory with no selected package                                                   | Result validator                           |
| Book result without exact booking confirmation, or waitlist result without exact waitlist confirmation | Booking workflow and result schema         |
| Calendar URL on an unsupported outcome, or a fresh URL for another checkout class identifier           | Result validator                           |
| Stored result owned by another UUID                                                                    | Recovery validator                         |

## Outcome model

| Outcome                  | Meaning                                                                            | Exit |
| ------------------------ | ---------------------------------------------------------------------------------- | ---: |
| `BOOKED`                 | This invocation submitted once and observed exact booking confirmation             |    0 |
| `WAITLISTED`             | This invocation submitted once and observed exact waitlist confirmation            |    0 |
| `ALREADY_BOOKED`         | Arketa authoritatively showed existing booking; no submission occurred             |    0 |
| `ALREADY_WAITLISTED`     | Arketa authoritatively showed existing waitlist enrollment; no submission occurred |    0 |
| `DRY_RUN`                | Non-submitting inspection completed with canonical availability and evidence       |    0 |
| `SAFE_STOP`              | A deliberate pre-submission safety condition prevented a click                     |   20 |
| `TECHNICAL_FAILURE`      | A known failure occurred before submission could have happened                     |   30 |
| `CONFIRMATION_UNCERTAIN` | One click may have succeeded, but matching confirmation was not established        |   40 |

`CONFIRMATION_UNCERTAIN` is terminal for automatic processing of that UUID. The application never retries automatically. A person or external orchestrator may deliberately issue another request; Arketa remains authoritative and prevents duplicate enrollment.

## Package evidence

The policy contains an ordered allowlist. The checkout reader retains trustworthy active class-package rows with positive safe-integer balances in page order. Product offers, inactive rows, zero balances, unsafe balances, and ambiguous rows do not become result evidence.

Package names are normalized for comparison by trimming surrounding whitespace and edge decoration and collapsing internal whitespace. Matching remains case-sensitive and preserves internal punctuation, numbers, and spelling. The first eligible package in policy order is selected.

Final results pair `package_selected` with `packages_before`:

- approved entries use the policy's canonical spelling;
- unapproved entries use normalized Arketa spelling;
- `package_selected` names the exact approved positive-balance entry, or is `null` only when no recorded entry is approved;
- fresh results are checked against the policy loaded for that invocation;
- recovered results are checked for internal and journal coherence without applying a later policy to a historical transaction.

## Confirmation and optional calendar metadata

Booking success requires exactly `You are Booked!`; waitlist success requires exactly `You're on the waitlist`. The opposite, missing, or duplicate confirmation is not treated as success.

For fresh booked states, an optional Google Calendar URL is accepted only when it is a strict HTTPS `app.arketa.co` calendar endpoint for the same checkout class identifier. Link hydration shares the single confirmation deadline. The link is metadata, not proof of enrollment, so an absent link does not turn a confirmed booking into failure. Recovery validates a stored link's strict endpoint shape and safe class identifier, but it cannot re-bind that link to the original checkout URL because the original request is intentionally not persisted.

## Files and transport

The private runtime contains a shared browser profile and lock plus request-scoped journals and results. Each canonical request UUID maps to one journal filename and one result filename. Temporary files and atomic rename prevent partially written destination JSON during normal operation.

Fresh finalization writes compact JSON followed by one newline. The stored bytes are the source of stdout: new completion and coherent recovery both emit the exact result-file bytes once. Recovery preserves an existing coherent result's byte representation, including noncanonical whitespace or field order, rather than rewriting it. If stdout fails, the durable result remains available, the command emits a fixed stderr diagnostic, and it exits 30.

See [Safety boundaries](safety-boundaries.md) for the trust model and for guarantees that are intentionally outside v0.1.0.
