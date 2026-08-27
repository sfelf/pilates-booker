# pilates-booker

`pilates-booker` provides a narrow, fail-closed Playwright transaction boundary for an external scheduler. The scheduler discovers a target checkout and handles reporting; this project independently validates the checkout and performs at most one authorized booking or waitlist submission.

## Data handling

Synthetic sample data is used in source code, tests, documentation, issues, pull requests, and CI output.

Browser profiles, authenticated state, booking policies, runtime requests and results, journals, logs, screenshots, traces, and live page captures remain outside Git.

## Local checks

The repository targets Node.js 22. Run `npm ci`, then use `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. These checks do not install or access a browser profile.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
