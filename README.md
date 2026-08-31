# pilates-booker

`pilates-booker` is a command-line tool for previewing or submitting one Arketa booking or waitlist request. It checks the supplied checkout, request, and policy before it can make an attempt.

Start with a dry run: it inspects the checkout without submitting. Read that result before continuing. A live run can make one external booking or waitlist attempt.

## Safety first

This program does not discover or schedule classes, automate login, solve CAPTCHA or MFA, retry automatically, or guarantee success after uncertainty. It stops safely outside its supported boundary and can make at most one external booking or waitlist submission only after you explicitly set a request to live mode. Arketa remains authoritative for enrollment state.

Keep all private runtime artifacts outside this checkout and outside Git: authenticated browser profile state, booking URLs, attendee information, injury content, requests, policies, journals, results, screenshots, traces, cookies, and live page captures. The tracked configuration files are synthetic examples only.

## Prerequisites

- Node.js `>=22.12.0` and the npm bundled with Node.js.
- Git.
- An Arketa account that you can authenticate manually.
- A supported operating system capable of running Playwright Chromium.

## Install Pilates Booker

From the repository checkout, install the locked dependencies, install the supported browser, and build the command:

```sh
npm ci
npx playwright install chromium
npm run build
```

In PowerShell:

```powershell
npm ci
npx playwright install chromium
npm run build
```

## Keep private files private

Create a private base and runtime directory outside the checkout before browser-profile bootstrap. The runtime stores journals and results; the profile stores browser authentication; the policy and request are private configuration files.

On POSIX shells, choose an absolute path outside the repository:

```sh
umask 077
private_root="/absolute/private/pilates-booker"
runtime="$private_root/runtime"
profile="$runtime/Profile"
policy="$private_root/booking-policy.json"
request="$private_root/booking-request.json"
mkdir -p -m 700 "$private_root" "$runtime"
chmod 700 "$private_root" "$runtime"
```

In PowerShell, use a per-user base with `Join-Path`:

```powershell
$privateRoot = Join-Path $env:LOCALAPPDATA "pilates-booker"
$runtime = Join-Path $privateRoot "runtime"
$profile = Join-Path $runtime "Profile"
$policy = Join-Path $privateRoot "booking-policy.json"
$request = Join-Path $privateRoot "booking-request.json"
New-Item -ItemType Directory -Force $privateRoot | Out-Null
New-Item -ItemType Directory -Force $runtime | Out-Null
```

On Windows, confirm that inherited ACLs restrict the private base, runtime, copied policy and request files, and generated profile to your Windows account. Never commit or share these paths or their contents. Do not keep this runtime directory inside the repository.

## Sign in to Arketa

Use a dedicated Arketa profile, not your everyday browser profile. It contains authenticated state, so do not commit it, share it, or use it in another browser while a booking command runs.

Open Arketa in that dedicated profile, sign in and complete MFA manually if prompted, then close the Playwright browser before running the command. On POSIX shells:

```sh
npx playwright open --user-data-dir "$profile" "https://app.arketa.co"
```

In PowerShell:

```powershell
npx playwright open --user-data-dir $profile "https://app.arketa.co"
```

The command does not automate login or follow sign-in redirects. If the session expires, repeat this manual sign-in with the same dedicated profile, then close the browser again.

## Create private request and policy files

Copy the tracked [synthetic policy example](config/booking-policy.example.json) and [synthetic request example](config/booking-request.example.json) into your private paths. Run these commands from the repository checkout.

On POSIX shells:

```sh
cp config/booking-policy.example.json "$policy"
cp config/booking-request.example.json "$request"
chmod 600 "$policy" "$request"
```

In PowerShell:

```powershell
Copy-Item config/booking-policy.example.json $policy
Copy-Item config/booking-request.example.json $request
```

Edit the private copies, never the examples:

- Give `request_id` a fresh lowercase canonical request UUID. That UUID owns the runtime journal and result for this one transaction.
- Set `booking_url` to the checkout you intend to validate. You are responsible for selecting the checkout link for the correct year: the supported checkout displays weekday, month, and day but not a year.
- Set `expected_class.name`, `expected_class.date`, and `expected_class.start_time` to the class you expect. Use an IANA timezone in the `America/*` namespace for `expected_class.timezone`.
- Keep `reserve_for: "myself"`, and list only the permitted `book` and/or `waitlist` actions in `permitted_actions`.
- Make `policy_version` match the private policy file. List `allowed_packages` in preference order; the command considers the first configured package with a positive approved balance.
- Keep `allow_monetary_charge: false`. A positive approved balance on the selected package is the complete no-charge evidence; the command does not infer it from payment text or controls.
- For a first use, keep `"dry_run": true` exactly. Do not change it yet.

## Run a dry run

Keep `"dry_run": true`. A dry run may inspect the page and expand `View Details` for existing-enrollment evidence, but it does not change booking fields or submit.

On POSIX shells:

```sh
npm start -- --runtime "$runtime" --policy "$policy" "$request"
```

In PowerShell:

```powershell
npm start -- --runtime $runtime --policy $policy $request
```

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

```sh
npm start -- --runtime "$runtime" --policy "$policy" "$request"
```

```powershell
npm start -- --runtime $runtime --policy $policy $request
```

## Troubleshooting

- **Expired authentication:** reopen Arketa with the same dedicated profile, authenticate manually, and close the browser. After a finalized `SAFE_STOP` or `TECHNICAL_FAILURE`, preserve the finalized evidence and apply the rerun rule in `Recover safely` with a fresh lowercase canonical request UUID. Retain the existing UUID only if no result was finalized and it is appropriate after correcting the command failure.
- **Existing runtime lock:** wait for the active command, or manually remove a stale lock only after you verify that no booking process is running.
- **Safe stop (`20`):** correct the request, policy, authentication, or supported page state, then apply the rerun rule in `Recover safely`; do not add speculative selector fallbacks.
- **Technical failure (`30`):** if stdout has a finalized result, preserve its evidence and apply the rerun rule in `Recover safely`. If no finalized result was emitted, use `Booking command failed.` as the fixed stderr marker and inspect private runtime evidence without deleting anything.
- **Confirmation uncertainty (`40`):** preserve evidence, inspect the durable result and Arketa, and decide deliberately whether a new request UUID is appropriate; never automatically retry.
- **No calendar link:** `google_calendar_url` is optional metadata, so rely on exact Arketa confirmation or authoritative existing-enrollment evidence instead.
- **Changed or unsupported checkout:** stop safely; do not work around CAPTCHA, guess selectors, or proceed until the checkout is supported again.

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
