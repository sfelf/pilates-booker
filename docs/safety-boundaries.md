# Safety boundaries

Pilates Booker is designed for a private, single-user runtime with cooperating local processes. Its primary risk is an unintended or ambiguous external booking action, not hostile same-account filesystem activity. The implementation therefore concentrates checks at request, browser-observation, pre-submission, confirmation, and publication boundaries without claiming database-grade durability.

## Field and trust policy

| Data                                                         | Source and trust                                                          | Runtime use                                                                                               | Result or diagnostic projection                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Request UUID, expected class, actions, mode, and booking URL | Caller-supplied and untrusted until schema and semantic validation        | Selects the request-scoped files and constrains the permitted checkout action                             | Validated request fields may appear only where the result contract permits them; diagnostics use fixed markers                      |
| Policy version and allowed package names                     | Explicit external file, trusted only after schema and semantic validation | Authorizes package names in deterministic policy order                                                    | Fresh package evidence is checked against canonical policy names; policy paths and raw contents are excluded from diagnostics       |
| Checkout URL and navigation                                  | Caller and browser supplied, untrusted                                    | Must remain a strict supported Arketa checkout                                                            | Raw URLs and private class identifiers are excluded from diagnostics; only a validated calendar URL may appear in permitted results |
| Class name, displayed date and time, instructor              | External page text, untrusted                                             | Class identity is compared after constrained inspection; instructor is informational                      | Accepted class evidence may be serialized; instructor is not an authorization fact                                                  |
| Package names and balances                                   | External page content, untrusted                                          | Rows are classified, names normalized for exact matching, and balances checked as positive safe integers  | Only trustworthy normalized package evidence is serialized; inspection-only decoded forms are never returned                        |
| Attendee and injuries                                        | Private page/profile content, untrusted                                   | Requires `Myself`; preserves a non-empty injuries value or enters fixed `None`                            | Attendee identity and injury answers never enter results or diagnostics                                                             |
| Cancellation and action controls                             | External DOM state, untrusted                                             | Must be uniquely bound and enabled in the final logical authorization read under the page-stability model | Only fixed safety booleans and outcome enums are serialized                                                                         |
| Booking or waitlist confirmation                             | External DOM state, authoritative for enrollment                          | Exact matching confirmation determines success                                                            | Fixed result outcome only; unrelated page content is excluded                                                                       |
| Journal and result JSON                                      | Private serialized runtime evidence, untrusted until validation           | Drives monotonic recovery and exact-byte replay                                                           | Valid result bytes are emitted exactly as stored; malformed, foreign, or contradictory artifacts are preserved and rejected         |
| Internal exceptions and stream errors                        | Implementation/runtime data                                               | Selects a fixed failure path                                                                              | Raw messages, stacks, paths, URLs, page text, and identifiers are not printed                                                       |

## Booking authorization

A live submission is authorized only when one logical pre-submission read establishes all of the following. The implementation obtains these live facts sequentially and relies on the supported page remaining stable throughout the read:

- the observed class matches the validated request's name, displayed month and day, start time, and supported `America/*` timezone interpretation;
- the exact permitted booking or waitlist action is uniquely bound and enabled;
- `Myself` is the uniquely selected reservation target;
- the injuries response is non-empty;
- cancellation is uniquely accepted and enabled;
- the selected package is the first eligible configured package in policy order;
- that selected package has a trustworthy positive safe-integer balance.

The positive balance is the complete project-level `no_charge` evidence. The application does not inspect payment text, credit-card controls, purchase steps, or other monetary surfaces.

If a required fact is missing, disabled, duplicated, ambiguous, or contradictory, the workflow does not click. The page-stability operating model continues from the start of the logical read until the immediate single click. The workflow does not add a second speculative page reread.

## Submission and confirmation boundary

The coordinator records `SUBMITTING` immediately before one bounded click on the exact permitted action. No automatic retry exists.

After the click, the workflow checks only the matching exact Arketa confirmation. It does not recheck the checkout URL, reservation target, injuries, package, cancellation, or other form state after submission. Those fields authorize the click; they are not post-click proof.

An already-booked or already-waitlisted page is authoritative and produces an existing-enrollment outcome without a booking or waitlist submission click. The read may still expand `View Details` to obtain confirmation evidence. This also makes deliberate recovery outside the application safe from duplicate enrollment: Arketa, rather than local speculation, reconciles the repeat.

## Result and recovery boundary

Fresh publication checks the result against the validated request and loaded policy, including permitted actions and canonical policy-bound package names. The executor is a trusted internal component: publication does not independently rerun its ordered package-selection algorithm, so the workflow remains responsible for selecting the first eligible package in policy order.

Recovery does not reinterpret a prior transaction through later request or policy contents. It validates the stored UUID, schema, package coherence, calendar endpoint shape, fixed details, and journal/outcome relationship. Because the original request is not persisted, recovery cannot re-bind stored calendar metadata to the original checkout class. A coherent finalized result is replayed exactly; malformed, foreign, or contradictory evidence is left untouched and fails with no stdout result.

An incomplete journal before `SUBMITTING` becomes a known pre-submission failure. An incomplete journal at `SUBMITTING` or later becomes `CONFIRMATION_UNCERTAIN`. This includes a `CONFIRMED` journal whose result finalization was interrupted after matching confirmation was observed. Recovery never opens the browser and never clicks again for the same UUID.

## Diagnostic boundary

Diagnostics are fixed, printable, single-line messages on stderr. They do not include secrets, profile data, raw page text, policy contents, request identifiers, URLs, filesystem paths, exception messages, or stack traces.

Inspection may decode or normalize external text to recognize unsafe or equivalent forms, but decoded inspection values never replace the original data in output. Redaction and fixed markers do not gain information through repeated decoding. Legitimate catalog punctuation, Unicode, filenames, and platform paths remain usable where the contract allows them.

## v0.1.0 guarantees

The supported implementation guarantees:

- strict request, policy, journal, and result schemas with unknown-property rejection;
- explicit policy input and a dedicated private browser profile;
- non-submitting dry run with zero booking-field and form mutation; existing-enrollment inspection may expand `View Details`;
- one logical pre-submission authorization read under the stable-page operating model;
- at most one booking or waitlist click per invocation;
- no automatic retry after uncertainty;
- exact matching authoritative confirmation for submitted success;
- request-scoped journals and results with cooperating-process locking;
- temporary-file atomic replacement during normal operation;
- exact finalized result bytes written once to stdout;
- private-safe fixed diagnostics;
- fail-closed handling of unsupported or ambiguous checkout structure.

## Explicit non-guarantees

v0.1.0 does not provide:

- scheduling, class discovery, trigger integration, or reporting integration;
- automated login, MFA, CAPTCHA handling, or session repair;
- support for non-Arketa hosts, alternate checkout structures, frames, or shadow DOM;
- support for timezone namespaces outside `America/*`;
- independent verification of the class year, which the calling process supplies through the chosen link;
- payment-interface inspection or monetary authorization beyond an approved package's positive balance;
- protection from concurrent manual interaction, browser-extension mutation, spontaneous page mutation during the sequential final read or before the click, or later navigation after the initial URL check;
- automatic retry, automatic stale-lock removal, or automatic recovery clicks;
- hostile same-account filesystem-race protection;
- `fsync`, directory synchronization, power-loss-proof persistence, or database transaction guarantees;
- proof that `CONFIRMED` is persisted at the instant the browser first renders confirmation while optional calendar metadata is still hydrating;
- screenshots, traces, HTML captures, cookie export, storage export, or other private debugging artifacts.

These are scope boundaries, not undocumented implementation gaps. A future change should add one only when an operational use case justifies its cost and should update the state model, field policy, tests, and public documentation together.

## Key engineering decisions

| Decision                                                             | Reason                                                                        | Accepted trade-off                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Treat Arketa as authoritative for enrollment                         | The service prevents duplicate booking and waitlist enrollment                | Local state does not attempt to become a transaction database                                  |
| Never retry automatically                                            | A missing confirmation cannot prove that the click failed                     | A person or orchestrator must deliberately reconcile uncertainty                               |
| Use one logical final read, then click                               | This binds all required authorization facts without speculative revalidation  | Page mutation during the sequential read or before the click is outside the operating model    |
| Use positive approved package balance as complete no-charge evidence | It matches the supported checkout and avoids payment-surface coupling         | The application does not independently inspect monetary controls                               |
| Verify only exact confirmation after submission                      | Confirmation proves enrollment; form fields only authorize the click          | Reservation, package, cancellation, and URL are not rechecked afterward                        |
| Let optional calendar metadata share the confirmation deadline       | The link is useful metadata but not success evidence                          | A process exit during link hydration can recover as uncertainty even after the marker appeared |
| Replay finalized bytes for a reused UUID                             | The finalized artifact is the immutable result of that transaction            | Later request or policy changes do not reinterpret historical evidence                         |
| Use atomic replacement without explicit synchronization              | It prevents partial destination JSON in the private cooperating-process model | Sudden power loss can lose recent local evidence                                               |
| Keep selectors narrow and explicit                                   | Ambiguity stops before an unintended click                                    | Arketa layout changes require deliberate compatibility work                                    |

## Compatibility versus safety

Safety rules are stable logical boundaries: exact request authorization, coherent package evidence, one-click submission, authoritative confirmation, recovery classification, and private output.

Selectors are compatibility details for the currently supported Arketa main-frame, light-DOM checkout. A selector change can make a supported page stop safely without weakening the safety model. Supporting a new frame, shadow root, alternate control, confirmation phrase, or checkout layout requires explicit reconciliation in the reader, fixtures, tests, and documentation; it must not be added as a speculative fallback.

See [Architecture](architecture.md) for component ownership and end-to-end flow.
