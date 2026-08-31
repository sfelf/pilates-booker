# pilates-booker

`pilates-booker` is a command-line tool for previewing or submitting one Arketa booking or waitlist request. It checks the supplied checkout, request, and policy before it can make an attempt.

Start with a dry run: it inspects the checkout without submitting. Read that result before continuing. A live run can make one external booking or waitlist attempt without another prompt.

## Before you begin

Pilates Booker does not discover or schedule classes, automate login, solve CAPTCHA or MFA, retry automatically, or guarantee success after uncertainty. It stops safely outside its supported boundary and can make at most one external booking or waitlist submission only after you explicitly set a request to live mode. Arketa remains authoritative for enrollment state.

Keep all private artifacts outside this checkout and outside Git: authenticated browser profile state, booking URLs, attendee information, injury content, requests, policies, journals, results, screenshots, traces, cookies, and live page captures. The tracked configuration files are synthetic examples only.

You need:

- A macOS, Linux, or Windows computer.
- Node.js `>=22.12.0` and the npm bundled with Node.js.
- Git.
- An Arketa account that you can authenticate manually.

Check the installed tools.

### macOS or Linux

```sh
git --version
node --version
npm --version
```

### Windows PowerShell

```powershell
git --version
node --version
npm --version
```

## Install Pilates Booker

Choose a private location for the repository. These examples use `$HOME/Tools/pilates-booker` on macOS or Linux and `C:\Tools\pilates-booker` on Windows.

### macOS or Linux

```sh
mkdir -p "$HOME/Tools"
git clone https://github.com/sfelf/pilates-booker.git "$HOME/Tools/pilates-booker"
cd "$HOME/Tools/pilates-booker"
npm ci
npx playwright install chromium
npm run build
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "C:\Tools" | Out-Null
git clone https://github.com/sfelf/pilates-booker.git C:\Tools\pilates-booker
Set-Location "C:\Tools\pilates-booker"
npm ci
npx playwright install chromium
npm run build
```

A successful build creates `dist/main.js`. `npm ci` installs the locked dependencies. Re-run `npm ci` after dependency changes and `npm run build` after source changes.

## Create the private runtime directory

The runtime stores the authenticated browser profile and evidence that prevents accidental repeat submission. It must be an absolute, private, stable directory outside the repository, and you must reuse it for every invocation.

| Platform | Runtime directory                                      |
| -------- | ------------------------------------------------------ |
| macOS    | `$HOME/Library/Application Support/Pilates Booker`     |
| Linux    | `${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker` |
| Windows  | `$env:LOCALAPPDATA\Pilates Booker`                     |

Create it:

### macOS

```sh
umask 077
install -d -m 700 "$HOME/Library/Application Support/Pilates Booker"
```

### Linux

```sh
umask 077
install -d -m 700 "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker"
```

### Windows PowerShell

```powershell
$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"
New-Item -ItemType Directory -Force $runtime | Out-Null
```

On Windows, `LOCALAPPDATA` is the current user's private application-data root. Confirm that inherited ACLs restrict the runtime, copied policy and request files, and generated profile to your Windows account. Never commit or share these paths or their contents. Do not keep this runtime directory inside the repository.

| Path below `<runtime>`       | Purpose                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `Profile/`                   | Dedicated local browser profile for manual Arketa authentication.          |
| `run.lock`                   | Prevents simultaneous booking processes.                                   |
| `journals/<request-id>.json` | Private request-scoped progress evidence used for recovery.                |
| `results/<request-id>.json`  | Private finalized result evidence used for exact-byte replay and recovery. |

## Sign in to Arketa

The application appends `Profile` to the exact runtime directory passed with `--runtime`. The commands below open that same profile, so signing in here signs in the application profile.

Run the command for your platform from the repository root:

### macOS

```sh
npx playwright open --user-data-dir "$HOME/Library/Application Support/Pilates Booker/Profile" "https://app.arketa.co"
```

### Linux

```sh
npx playwright open --user-data-dir "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker/Profile" "https://app.arketa.co"
```

### Windows PowerShell

```powershell
$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"
npx playwright open --user-data-dir "$runtime\Profile" "https://app.arketa.co"
```

In the opened Chromium window:

1. Sign into Arketa normally, including any MFA.
2. Visit `https://app.arketa.co` again and confirm you remain signed in.
3. Close the entire Chromium window.

The profile contains authenticated state, so do not commit it, share it, or use it in another browser while a booking command runs. The command does not automate login or follow sign-in redirects. If the session expires, repeat this manual sign-in with the same dedicated profile, then close the browser again.

## Create your private configuration

Create a private configuration folder outside the repository. These examples use `$HOME/Private/Pilates Booker` on macOS or Linux and the current Windows user's local application-data directory.

### macOS or Linux

```sh
install -d -m 700 "$HOME/Private/Pilates Booker"
install -m 600 config/booking-policy.example.json "$HOME/Private/Pilates Booker/booking-policy.json"
install -m 600 config/booking-request.example.json "$HOME/Private/Pilates Booker/booking-request.json"
node -e "console.log(require('node:crypto').randomUUID())"
```

### Windows PowerShell

```powershell
$config = Join-Path $env:LOCALAPPDATA "Pilates Booker Config"
New-Item -ItemType Directory -Force $config | Out-Null
Copy-Item config\booking-policy.example.json "$config\booking-policy.json"
Copy-Item config\booking-request.example.json "$config\booking-request.json"
node -e "console.log(require('node:crypto').randomUUID())"
```

The copied files come from the tracked [synthetic policy example](config/booking-policy.example.json) and [synthetic request example](config/booking-request.example.json). Edit the private copies in a text editor. Do not edit the tracked examples with real data.

Use the generated lowercase UUID as `request_id`, then apply these rules:

- Give `request_id` a fresh lowercase canonical request UUID. That UUID owns the runtime journal and result for this one transaction.
- Set `booking_url` to the checkout you intend to validate. You are responsible for selecting the checkout link for the correct year: the supported checkout displays weekday, month, and day but not a year.
- Set `expected_class.name`, `expected_class.date`, and `expected_class.start_time` to the class you expect. Use an IANA timezone in the `America/*` namespace for `expected_class.timezone`.
- Keep `reserve_for: "myself"`, and list only the permitted `book` and/or `waitlist` actions in `permitted_actions`.
- Make `policy_version` match the private policy file. List `allowed_packages` in preference order; the command considers the first configured package with a positive approved balance.
- Keep `allow_monetary_charge: false`. A positive approved balance on the selected package is the complete no-charge evidence; the command does not infer it from payment text or controls.
- For a first use, keep `"dry_run": true` exactly. Do not change it yet.

## Run a dry run

Keep `"dry_run": true`. A dry run may inspect the page and expand `View Details` for existing-enrollment evidence, but it does not change booking fields or submit.

### macOS

```sh
node "$HOME/Tools/pilates-booker/dist/main.js" \
  --runtime "$HOME/Library/Application Support/Pilates Booker" \
  --policy "$HOME/Private/Pilates Booker/booking-policy.json" \
  "$HOME/Private/Pilates Booker/booking-request.json"
```

### Linux

```sh
node "$HOME/Tools/pilates-booker/dist/main.js" \
  --runtime "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker" \
  --policy "$HOME/Private/Pilates Booker/booking-policy.json" \
  "$HOME/Private/Pilates Booker/booking-request.json"
```

### Windows PowerShell

```powershell
$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"
$config = Join-Path $env:LOCALAPPDATA "Pilates Booker Config"
node C:\Tools\pilates-booker\dist\main.js `
  --runtime "$runtime" `
  --policy "$config\booking-policy.json" `
  "$config\booking-request.json"
```

Quote every path that may contain spaces.

Wait for the command to finish. Read its result before authorizing any live action.

## Read the result

Stdout is the sole machine-readable finalized result channel. A fresh finalization writes one compact JSON object plus a newline. A same-UUID replay emits the exact stored bytes, including existing whitespace, field order, and newline. A finalized `TECHNICAL_FAILURE` is JSON on stdout with exit `30`. The fixed stderr line `Booking command failed.` is used only when no finalized result can be emitted.

| Exit | Meaning                                                                             | Operator action                                                                                                         |
| ---- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `0`  | Confirmed booking/waitlist, authoritative existing enrollment, or completed dry run | Read the JSON outcome; do not infer booking from optional metadata                                                      |
| `20` | Safe stop before submission                                                         | Preserve and inspect the finalized result; correct the cause, assign a fresh request UUID, then make a deliberate rerun |
| `30` | Command/technical failure                                                           | Read stdout first; use the technical-failure path below                                                                 |
| `40` | Submission or later processing may have occurred without a finalized success result | Reconcile with Arketa and the durable result; never automatically retry                                                 |

A dry run reports availability and evidence without submitting; it is not a live outcome. When package evidence applies, `packages_before` records the inventory and its positive-balance/selectability evidence, and `package_selected` identifies the selected package. The field package_selected can be `null` in a coherent safe-stop result when trustworthy positive-balance inventory exists but no package matches the policy allowlist. `google_calendar_url` is optional metadata only for its documented eligible outcomes. Exact Arketa confirmation or authoritative existing-enrollment evidence determines success, not that link or other optional metadata.

## Recover safely

Treat a UUID as one transaction: it owns one journal/result pair. A same request UUID with a finalized result returns that result without opening the browser. An incomplete journal before submission becomes a technical failure; recovery at `SUBMITTING` or later can finalize `CONFIRMATION_UNCERTAIN`.

Uncertainty is not proof of failure. Preserve the durable result and journal, inspect both the durable result and Arketa, then deliberately choose a new request UUID if needed. The app does not retry automatically; Arketa is authoritative for already-booked and already-waitlisted state.

Use one deliberate rerun rule when a corrected cause warrants another attempt. If a finalized result exists, preserve and inspect it, correct the cause, assign a fresh lowercase canonical request UUID, then deliberately rerun. This applies after finalized `SAFE_STOP` or finalized `TECHNICAL_FAILURE`. If no finalized result exists, after correcting the command failure, retain or reuse the request UUID only when appropriate before deciding whether to deliberately run again. Do not assume a stored UUID result exists.

When no finalized result was emitted, use the fixed stderr marker `Booking command failed.` and private runtime evidence instead. The marker does not prove a stored result exists.

A stale lock is `<runtime>/run.lock`. Only after you verify that no booking process is running, remove it manually:

```sh
rm "$runtime/run.lock"
```

```powershell
Remove-Item -LiteralPath (Join-Path $runtime "run.lock")
```

## Make one live attempt

Only continue after you have inspected a successful dry-run result; preserve the finalized dry-run UUID and evidence. Then make the two required live-authorizing edits: assign a fresh request UUID, then set `dry_run` from `true` to `false`. This creates a new live journal/result pair; reusing the dry-run UUID only replays its dry-run result. The next invocation can perform one external booking or waitlist mutation.

For a live request, Arketa must remain stable throughout the sequential authorization read and until the single submission click. Within that supported stable-page model, the command:

- reads the relevant checkout facts sequentially;
- applies the required `Myself` attendee selection, preserves a non-empty injuries response or supplies `None` for an empty one, and accepts the cancellation policy;
- uses the first eligible configured positive-balance package and permits only the exact requested action; and
- may expand `View Details` for existing-enrollment evidence without submitting.

After the one submission click, the command checks only for the matching exact Arketa confirmation. It does not recheck form fields or the URL afterward.

Run the same platform command only after making those two edits:

### macOS

```sh
node "$HOME/Tools/pilates-booker/dist/main.js" \
  --runtime "$HOME/Library/Application Support/Pilates Booker" \
  --policy "$HOME/Private/Pilates Booker/booking-policy.json" \
  "$HOME/Private/Pilates Booker/booking-request.json"
```

### Linux

```sh
node "$HOME/Tools/pilates-booker/dist/main.js" \
  --runtime "${XDG_STATE_HOME:-$HOME/.local/state}/pilates-booker" \
  --policy "$HOME/Private/Pilates Booker/booking-policy.json" \
  "$HOME/Private/Pilates Booker/booking-request.json"
```

### Windows PowerShell

```powershell
$runtime = Join-Path $env:LOCALAPPDATA "Pilates Booker"
$config = Join-Path $env:LOCALAPPDATA "Pilates Booker Config"
node C:\Tools\pilates-booker\dist\main.js `
  --runtime "$runtime" `
  --policy "$config\booking-policy.json" `
  "$config\booking-request.json"
```

## Troubleshooting

| Symptom                         | Action                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expired authentication          | Reopen Arketa with the same dedicated profile, authenticate manually, and close the browser. After a finalized `SAFE_STOP` or `TECHNICAL_FAILURE`, preserve the finalized evidence and apply the rerun rule in `Recover safely` with a fresh lowercase canonical request UUID. Retain the existing UUID only if no result was finalized and it is appropriate after correcting the command failure. |
| Existing runtime lock           | Wait for the active command, or manually remove a stale lock only after you verify that no booking process is running.                                                                                                                                                                                                                                                                              |
| Safe stop (`20`)                | Correct the request, policy, authentication, or supported page state, then apply the rerun rule in `Recover safely`; do not add speculative selector fallbacks.                                                                                                                                                                                                                                     |
| Technical failure (`30`)        | If stdout has a finalized result, preserve its evidence and apply the rerun rule in `Recover safely`. If no finalized result was emitted, use `Booking command failed.` as the fixed stderr marker and inspect private runtime evidence without deleting anything.                                                                                                                                  |
| Confirmation uncertainty (`40`) | Preserve evidence, inspect the durable result and Arketa, and decide deliberately whether a new request UUID is appropriate; never automatically retry.                                                                                                                                                                                                                                             |
| No calendar link                | `google_calendar_url` is optional metadata, so rely on exact Arketa confirmation or authoritative existing-enrollment evidence instead.                                                                                                                                                                                                                                                             |
| Changed or unsupported checkout | Stop safely; do not work around CAPTCHA, guess selectors, or proceed until the checkout is supported again.                                                                                                                                                                                                                                                                                         |

Keep private runtime artifacts out of tickets, commits, and public diagnostics.

## Development validation

After `npm ci`, repository checks that do not access a browser profile are:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

Ubuntu CI is authoritative for executable Bash/POSIX permission behavior. The deterministic README test checks PowerShell blocks and ordering without claiming a live Windows booking.

## Architecture and safety reference

[Architecture](docs/architecture.md) describes components, data flow, state transitions, and the result model; [Safety boundaries](docs/safety-boundaries.md) defines trusted inputs, authorization, guarantees, non-guarantees, and supported checkout assumptions.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
