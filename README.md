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

The repository targets Node.js 22. Run `npm ci`, then use `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. These checks do not install or access a browser profile.

## Booking policy

Every run requires `--policy <path>` before the request path. Relative policy paths resolve from the invoking working directory; absolute paths are accepted. The repository never falls back to a local policy. [`config/booking-policy.example.json`](config/booking-policy.example.json) is synthetic and must be copied outside the repository before adding private configuration.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
