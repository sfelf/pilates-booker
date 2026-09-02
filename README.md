# pilates-booker

[![CI status](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml) [![Release: v0.2.0](https://img.shields.io/badge/release-v0.2.0-blue)](https://github.com/sfelf/pilates-booker/releases/tag/v0.2.0) [![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE) [![Node.js >=22.12.0](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-339933?logo=nodedotjs&logoColor=white)](package.json)

Pilates Booker inspects or submits one Arketa booking or waitlist attempt from command-line arguments. Arketa is authoritative for enrollment state. The utility does not discover classes, schedule runs, automate login, or retry automatically.

## Install

Install Node.js `>=22.12.0`, clone this repository into a private location, and run:

```sh
npm ci
npx playwright install chromium
npm run build
```

Linux may require `npx playwright install --with-deps chromium`.

## Runtime and sign-in

The default private runtime is platform-specific:

| Platform | Default runtime                                        |
| -------- | ------------------------------------------------------ |
| macOS    | `$HOME/Library/Application Support/Pilates Booker`     |
| Linux    | `${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker` |
| Windows  | `$env:LOCALAPPDATA\Pilates Booker`                     |

Use `--runtime` with an absolute path to override the default. On macOS and Linux, protect a custom runtime with mode `700`. The runtime contains `Profile/`, the temporary `run.lock`, and opt-in debug logs only.

Sign in manually using the same profile before running the utility:

```sh
npx playwright open --user-data-dir "$HOME/Library/Application Support/Pilates Booker/Profile" "https://app.arketa.co"
```

On Linux or Windows, substitute the platform default shown above. Complete login and MFA, verify the session, and close Chromium before booking.

## Command

Start with a dry run:

```sh
node dist/main.js \
  --booking-url "https://app.arketa.co/iframe/STUDIO/calendar/checkout/CLASS" \
  --allow-package "10-Class Pack" \
  --allow-package "5-Class Pack" \
  --dry-run
```

`--booking-url` is required and must be a supported Arketa checkout URL. Repeat `--allow-package` in preference order; the first eligible positive-balance class package is selected. The caller is responsible for supplying the intended class URL, while `observed_class` in the result lets the caller verify what Arketa displayed.

Omitting `--dry-run` permits one live booking or waitlist attempt without another prompt:

```sh
node dist/main.js \
  --booking-url "https://app.arketa.co/iframe/STUDIO/calendar/checkout/CLASS" \
  --allow-package "10-Class Pack"
```

By default both booking and waitlisting are allowed. Add `--book-only` to stop safely instead of joining a waitlist. Add `--runtime "/absolute/private/path"` to override the platform default.

## Results and exits

Every reportable outcome writes one compact schema-version-2 JSON object followed by one newline.

| Outcome                  | Meaning                                                   | Exit |
| ------------------------ | --------------------------------------------------------- | ---: |
| `BOOKED`                 | Exact booking confirmation observed                       |    0 |
| `WAITLISTED`             | Exact waitlist confirmation observed                      |    0 |
| `ALREADY_BOOKED`         | Arketa showed an existing booking; no submission          |    0 |
| `ALREADY_WAITLISTED`     | Arketa showed existing waitlist enrollment; no submission |    0 |
| `DRY_RUN`                | Inspection completed without form mutation or submission  |    0 |
| `SAFE_STOP`              | A safety condition prevented submission                   |   20 |
| `TECHNICAL_FAILURE`      | Failure occurred before submission                        |   30 |
| `CONFIRMATION_UNCERTAIN` | Submission began but confirmation is not dependable       |   40 |

The result includes `observed_class` when the page could be inspected and includes package evidence where relevant. A missing JSON response cannot be recovered locally. Invoke the command again with the same URL; Arketa's existing-enrollment page is the supported reconciliation mechanism and prevents another enrollment submission.

## Debug logging

No debug log is touched unless `--debug` is present. With `--debug`, compact NDJSON records are written to `<runtime>/pilates-booker.log`. Before the current file would exceed 1 MiB it becomes `pilates-booker.log.1`, replacing the previous generation.

The log may contain the validated command arguments, complete booking URL, runtime path, observed class/package evidence, workflow decisions, numeric response status codes, and projected exception messages or stacks. It excludes request/response headers, cookies, tokens, browser storage/profile contents, attendee identity, injury/form values, HTML, screenshots, and traces. Treat the runtime and log as private.

## Troubleshooting

- `Booking command failed.` with no JSON means arguments, runtime setup, debug initialization, or stdout failed. Check argument spelling and, when enabled, the final debug-log event.
- Exit 20 means the checkout was unsupported, ambiguous, ineligible, or disallowed by `--book-only`; no submission occurred.
- Exit 40 means do not infer failure. Run the utility again and let Arketa report existing enrollment or offer an action.
- A leftover `run.lock` after a crash is not removed automatically. Confirm no Pilates Booker or profile Chromium process is active, then remove that exact lock file manually.
- Expired sessions require another manual sign-in with the same `Profile/` directory.

See [Architecture](docs/architecture.md) and [Safety boundaries](docs/safety-boundaries.md) for the implementation contract.
