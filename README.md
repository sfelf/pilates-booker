# pilates-booker

`pilates-booker` provides a narrow, fail-closed Playwright transaction boundary for an external scheduler. The scheduler discovers a target checkout and handles reporting; this project independently validates the checkout and performs at most one authorized booking or waitlist submission.

## Documentation

- [Architecture](docs/architecture.md) describes the components, data flow, state transitions, results, and recovery model.
- [Safety boundaries](docs/safety-boundaries.md) describes trusted inputs, external data handling, booking authorization, guarantees, non-guarantees, and supported checkout assumptions.

## Data handling

Synthetic sample data is used in source code, tests, documentation, issues, pull requests, and CI output.

Browser profiles, authenticated state, booking policies, runtime requests and results, journals, logs, screenshots, traces, and live page captures remain outside Git.

## Booking workflow

Dry runs inspect the supported checkout without changing booking fields or submitting; existing-enrollment inspection may expand `View Details` to reveal confirmation evidence. In a non-dry run, the workflow selects `Myself`, preserves a non-empty injuries response or fills an empty one with `None`, selects the first configured positive-balance package in policy order, accepts the cancellation policy, and clicks the permitted booking or waitlist action exactly once. After that click, it verifies only the matching exact Arketa confirmation: `You are Booked!` for a booking or `You're on the waitlist` for a waitlist submission. It does not recheck the URL or any checkout field after submission.

The workflow performs one logical authorization read after applying those checkout fields. That read obtains live facts sequentially and assumes the supported Arketa checkout remains stable throughout the read and until its single submission click. Concurrent user interaction, browser-extension mutation, and spontaneous checkout mutation during that interval are outside the v0.1.0 operating model.

The calling process is responsible for supplying the checkout link for the correct class year. Because the supported Arketa checkout displays the weekday, month, and day without a year, the workflow verifies those displayed components and the class time against the request; it does not derive a year from hidden page state.

v0.1.0 supports IANA timezones in the `America/*` namespace, including fractional-offset zones. Other timezone namespaces stop at request validation.

A positive balance on the selected approved package is the complete no-charge evidence. The workflow does not inspect payment text or controls.

The workflow does not retry automatically after submission uncertainty. A deliberate rerun is allowed, and Arketa's existing-enrollment state is authoritative.

Private attendee identity and raw injury content are excluded from results and diagnostics.

## Local checks

The repository targets Node.js 22. Run `npm ci`, then use `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`. These checks do not access a browser profile.

## Booking policy

Every run requires `--policy <path>` before the request path. Relative policy paths resolve from the invoking working directory; absolute paths are accepted. The repository never falls back to a local policy. [`config/booking-policy.example.json`](config/booking-policy.example.json) is synthetic and must be copied outside the repository before adding private configuration.

## Direct invocation

Install the supported Chromium build and compile the command once after `npm ci`:

```sh
npx playwright install chromium
npm run build
```

Create a dedicated absolute runtime directory outside this repository and copy both synthetic examples outside the repository before replacing them with private values. Keep the runtime, policy, request, generated journal, result, and authenticated browser profile out of Git. Close any browser already using the dedicated profile before invoking the command.

Bootstrap the dedicated profile manually before the first booking run. On POSIX shells, open Arketa with the same profile directory, complete sign-in or MFA, and then close the browser window:

```sh
npx playwright open --user-data-dir "/absolute/private/pilates-runtime/Profile" "https://app.arketa.co"
```

In PowerShell:

```powershell
$runtime = "C:\private\pilates-runtime"
$profile = Join-Path $runtime "Profile"
npx playwright open --user-data-dir $profile "https://app.arketa.co"
```

The booking command does not automate login or follow sign-in redirects. Repeat this manual bootstrap if the dedicated profile's authenticated session expires.

Start with `"dry_run": true`. On POSIX shells:

```sh
npm start -- --runtime "/absolute/private/pilates-runtime" --policy "/absolute/private/booking-policy.json" "/absolute/private/booking-request.json"
```

In PowerShell:

```powershell
$runtime = "C:\private\pilates-runtime"
$policy = "C:\private\booking-policy.json"
$request = "C:\private\booking-request.json"
npm start -- --runtime $runtime --policy $policy $request
```

Each canonical request UUID owns `<runtime>/journals/<uuid>.json` and `<runtime>/results/<uuid>.json`. Repeating a UUID returns the completed result without opening the browser; use a new UUID for a new requested transaction. The runtime lock prevents overlapping invocations against the same profile.

## Result contract and recovery

Fresh finalization stores one compact JSON object followed by one newline, and the command writes those exact bytes to stdout. Repeating the same UUID emits the exact stored result bytes again, preserving their existing whitespace, field order, and newline representation. Stdout is therefore the machine-readable result transport, while stderr is reserved for the fixed single-line diagnostic `Booking command failed.` when the command cannot produce or emit a finalized result. A stdout emission failure does not remove an already finalized result file.

The command exits `0` for a confirmed booking, waitlist, recognized existing enrollment, or dry run; `20` for a safe stop before submission; `30` for a command or technical failure; and `40` when post-submission processing or recovery lacks a finalized success result. Exit 40 covers both missing matching confirmation and interrupted result finalization after confirmation was journaled. The JSON result includes `package_selected` and `packages_before` only when package-selection evidence is applicable. A `google_calendar_url` is optional and appears only for `BOOKED`, `ALREADY_BOOKED`, or a `DRY_RUN` whose availability is `ALREADY_BOOKED`. Fresh publication accepts only the strict matching Arketa calendar URL for the checkout class; recovery validates a stored calendar URL's strict Arketa endpoint shape but cannot re-bind it to an original checkout URL that is not persisted.

Recovery returns a coherent finalized result for the same UUID without opening the browser. If only an incomplete journal exists, it finalizes a `TECHNICAL_FAILURE` for a pre-submission state or `CONFIRMATION_UNCERTAIN` for `SUBMITTING` or later, then emits that result without opening the browser. The command does not automatically retry a submission and does not claim stronger durability than the journal and result files. To request another booking attempt or a new transaction, create a new UUID and inspect the prior result before invoking it.

[`config/booking-request.example.json`](config/booking-request.example.json) and [`config/booking-policy.example.json`](config/booking-policy.example.json) contain synthetic values only. A non-dry run can perform one booking or waitlist submission, so inspect the dry-run result before changing `dry_run` to `false`.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
