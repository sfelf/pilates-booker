# pilates-booker

`pilates-booker` provides a narrow, fail-closed Playwright transaction boundary for an external scheduler. The scheduler discovers a target checkout and handles reporting; this project independently validates the checkout and performs at most one authorized booking or waitlist submission.

## Data handling

Synthetic sample data is used in source code, tests, documentation, issues, pull requests, and CI output.

Browser profiles, authenticated state, booking policies, runtime requests and results, journals, logs, screenshots, traces, and live page captures remain outside Git.

## Booking workflow

Dry runs inspect the supported checkout without changing it. In a non-dry run, the workflow selects `Myself`, preserves a non-empty injuries response or fills an empty one with `None`, selects the first configured positive-balance package in policy order, accepts the cancellation policy, and clicks the permitted booking or waitlist action exactly once. It then requires matching exact Arketa confirmation: `You are Booked!` for a booking or `You're on the waitlist` for a waitlist submission.

The workflow performs one coherent authorization read after applying those checkout fields, then assumes the supported Arketa checkout remains stable until its single submission click. Concurrent user interaction, browser-extension mutation, and spontaneous checkout mutation during that short interval are outside the v0.1.0 operating model.

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

The first interactive run uses `<runtime>/Profile`; sign in to Arketa in that dedicated window if needed. Each canonical request UUID owns `<runtime>/journals/<uuid>.json` and `<runtime>/results/<uuid>.json`. Repeating a UUID returns its completed result without opening the browser; use a new UUID for a new requested transaction. The runtime lock prevents overlapping invocations against the same profile.

[`config/booking-request.example.json`](config/booking-request.example.json) and [`config/booking-policy.example.json`](config/booking-policy.example.json) contain synthetic values only. A non-dry run can perform one booking or waitlist submission, so inspect the dry-run result before changing `dry_run` to `false`.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
