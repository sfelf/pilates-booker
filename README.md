# pilates-booker

[![CI status](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sfelf/pilates-booker/actions/workflows/ci.yml) [![Codecov coverage](https://codecov.io/gh/sfelf/pilates-booker/branch/main/graph/badge.svg)](https://app.codecov.io/gh/sfelf/pilates-booker) [![Release: v0.2.3](https://img.shields.io/badge/release-v0.2.3-blue)](https://github.com/sfelf/pilates-booker/releases/tag/v0.2.3) [![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE) [![Node.js 22.13–22.x or >=24](https://img.shields.io/badge/Node.js-22.13%E2%80%9322.x_or_%3E%3D24-339933)](package.json)

Pilates Booker inspects or submits one Arketa booking or waitlist attempt from command-line arguments. Arketa is authoritative for enrollment state. The utility does not discover classes, schedule runs, automate login, or retry automatically.

Pilates Booker is an independent project and is not affiliated with or endorsed by Arketa. You are responsible for ensuring your use complies with applicable platform terms and studio policies.

## Install

Install Node.js `^22.13.0 || >=24.0.0`, clone this repository into a private location, and run:

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

Use `--runtime` with an absolute path to override the default. Keep every runtime outside the repository checkout so authenticated profile data and debug logs cannot be added to Git. On macOS and Linux, every runtime must use mode `700`; the utility reapplies that mode before each attempt. On Windows, verify that Windows inherited ACLs restrict the runtime to the current account. The runtime contains `Profile/`, the exclusive `run.lock`, and opt-in debug logs only. A current lock contains versioned metadata with only the owner PID.

Before the first sign-in on macOS, create and protect the default runtime:

```sh
mkdir -p "$HOME/Library/Application Support/Pilates Booker" && chmod 700 "$HOME/Library/Application Support/Pilates Booker"
```

On Linux, create and protect its default runtime instead:

```sh
mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker" && chmod 700 "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker"
```

On Windows, create the default runtime and verify its inherited ACLs restrict access to the current account before opening the profile.

Sign in manually using the same profile before running the utility:

```sh
npx playwright open --user-data-dir "$HOME/Library/Application Support/Pilates Booker/Profile" "https://app.arketa.co"
```

On Linux or Windows, substitute the platform default shown above. Complete login and MFA, verify the session, and close Chromium before booking.

When using a custom runtime, sign in with that exact runtime's profile before passing the same path to the booking command:

```sh
npx playwright open --user-data-dir "/absolute/private/path/Profile" "https://app.arketa.co"
node dist/main.js --runtime "/absolute/private/path" --booking-url "https://app.arketa.co/iframe/STUDIO/calendar/checkout/CLASS" --allow-package "10-Class Pack" --dry-run
```

## Command

Start with a dry run:

```text
node dist/main.js --booking-url "https://app.arketa.co/iframe/STUDIO/calendar/checkout/CLASS" --allow-package "10-Class Pack" --allow-package "5-Class Pack" --dry-run
```

The one-line command works in POSIX shells and PowerShell.

`--booking-url` is required and must be a supported Arketa checkout URL. Repeat `--allow-package` in preference order; the first eligible positive-balance class package is selected. The caller is responsible for supplying the intended class URL, while `observed_class` in the result lets the caller verify what Arketa displayed.

Read the complete dry-run JSON result and verify that `observed_class` matches the class you intend to book, including its name, date, start time, and timezone. Proceed to a live command only after that verification; the application does not independently compare the displayed class with caller-supplied class fields.

Omitting `--dry-run` permits one live booking or waitlist attempt without another prompt:

```text
node dist/main.js --booking-url "https://app.arketa.co/iframe/STUDIO/calendar/checkout/CLASS" --allow-package "10-Class Pack"
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

## Response object

Every response has `schema_version`, `outcome`, `exit_code`, `action_submitted`, `confirmation_verified`, `safety_checks`, and the fixed `details` text for its outcome. Inspection results add `observed_class`; actionable dry runs add `availability`, `package_selected`, and `packages_before`. Confirmed bookings and waitlists include the same package evidence, and a confirmed booking may include `google_calendar_url`. Fields that do not apply to an outcome are omitted rather than set to an invented value.

This synthetic dry-run response is formatted for readability; the command emits the same object compactly on one line:

```json
{
  "schema_version": 2,
  "outcome": "DRY_RUN",
  "exit_code": 0,
  "action_submitted": false,
  "confirmation_verified": false,
  "availability": "BOOKING_AVAILABLE",
  "observed_class": {
    "name": "Reformer Fundamentals",
    "instructor": "Example Instructor",
    "date": "2026-09-01",
    "start_time": "09:30",
    "end_time": "10:20",
    "timezone": "America/Los_Angeles"
  },
  "package_selected": "10-Class Pack",
  "packages_before": [
    {
      "name": "10-Class Pack",
      "remaining": 3,
      "approved": true
    }
  ],
  "safety_checks": {
    "approved_package_verified": true,
    "no_charge": false,
    "cancellation_policy_accepted": false
  },
  "details": "Dry run completed."
}
```

## Debug logging

No debug log is touched unless `--debug` is present. With `--debug`, compact NDJSON records are written to `<runtime>/pilates-booker.log`. Before the current file would exceed 1 MiB it becomes `pilates-booker.log.1`, replacing the previous generation.

The log may contain the validated command arguments, complete booking URL, runtime path, observed class/package evidence, workflow decisions, numeric response status codes, and projected exception messages or stacks. It excludes request/response headers, cookies, tokens, browser storage/profile contents, attendee identity, injury/form values, HTML, screenshots, and traces. Treat the runtime and log as private.

## Troubleshooting

| Symptom or exit                        | Meaning and action                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Booking command failed.` with no JSON | Argument parsing, runtime-path resolution, or stdout transport failed. Check argument spelling and the runtime path. When stdout remains available, a debug logger initialization failure produces a schema-version-2 `TECHNICAL_FAILURE` result with exit 30.                                                                              |
| Exit 20                                | The checkout was unsupported, ambiguous, ineligible, or disallowed by `--book-only`; no submission occurred.                                                                                                                                                                                                                                |
| Exit 40                                | Do not infer failure. Run the utility again and let Arketa report existing enrollment or offer an action.                                                                                                                                                                                                                                   |
| Lock contention                        | Pilates Booker removes a valid current `run.lock` only when its recorded PID is conclusively absent. It revalidates the PID and device/inode immediately before removal, then retries exclusive acquisition once.                                                                                                                           |
| Lock remains after the process ended   | A legacy, malformed, unreadable, active, or indeterminate lock is preserved for manual recovery. PID reuse, an unreaped zombie, permission restrictions, or another ambiguous PID probe can make a stale lock appear active. Confirm no Pilates Booker or profile Chromium process is active before removing that exact lock file manually. |
| Lock changed during recovery           | PID and device/inode revalidation narrows the final replacement race, but pathname removal is not atomic for an exact open inode. The lock does not guarantee power-loss recovery or recover Chromium's own profile locks.                                                                                                                  |
| Session expired                        | Sign in manually again with the same `Profile/` directory.                                                                                                                                                                                                                                                                                  |

See [Architecture](docs/architecture.md) and [Safety boundaries](docs/safety-boundaries.md) for the implementation contract.

## License

Pilates Booker is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`); see [LICENSE](LICENSE).
