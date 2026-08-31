# pilates-booker

`pilates-booker` validates one supplied Arketa checkout and can make at most one authorized booking or waitlist submission. It is for a single, deliberate transaction: you supply the checkout and request, review a dry run, and decide whether to allow one live run.

## Safety first

This program does not discover or schedule classes, automate login, solve CAPTCHA or MFA, retry automatically, or guarantee success after uncertainty. It validates the supplied checkout, stops safely when it cannot continue within its supported boundary, and may perform one external booking or waitlist submission only after you set a request to live mode. Arketa remains authoritative for enrollment state.

Keep all private runtime artifacts outside this checkout and outside Git: authenticated browser profile state, booking URLs, attendee information, injury content, requests, policies, journals, results, screenshots, traces, cookies, and live page captures. The tracked configuration files are synthetic examples only.

## Prerequisites

- Node.js `>=22.12.0` and the npm bundled with Node.js.
- Git.
- An Arketa account that you can authenticate manually.
- A supported operating system capable of running Playwright Chromium.

## Install

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

## Keep runtime data private

Create a private base and runtime directory outside the checkout before browser-profile bootstrap. The runtime records journals and results; the profile holds browser authentication; the policy and request are your private configuration files.

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

## Authenticate a dedicated Arketa profile

The profile contains authenticated state. Use a dedicated Arketa profile, not your personal everyday browser profile; do not commit it, share it, or use it in another browser while a booking command runs.

Open Arketa in that dedicated profile, sign in and complete MFA manually if prompted, then close the Playwright browser before running the command. On POSIX shells:

```sh
npx playwright open --user-data-dir "$profile" "https://app.arketa.co"
```

In PowerShell:

```powershell
npx playwright open --user-data-dir $profile "https://app.arketa.co"
```

The command does not automate login or follow sign-in redirects. If the session expires, repeat this manual bootstrap with the same dedicated profile and close the browser again.

## Create private policy and request files

Copy only the tracked [synthetic policy example](config/booking-policy.example.json) and [synthetic request example](config/booking-request.example.json) into the private paths you created. Run these commands from the repository checkout.

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

Edit the private copies, never the examples, before you run the command:

- Give `request_id` a fresh UUID. That UUID owns the runtime journal and result for this one transaction.
- Set `booking_url` to the checkout you intend to validate. You are responsible for selecting the checkout link for the correct year: the supported checkout displays weekday, month, and day but not a year.
- Set `expected_class.name`, `expected_class.date`, and `expected_class.start_time` to the class you expect. Use an IANA timezone in the `America/*` namespace for `expected_class.timezone`.
- Keep `reserve_for: "myself"`, and list only the permitted `book` and/or `waitlist` actions in `permitted_actions`.
- Make `policy_version` match the private policy file. List allowed package names in `allowed_packages` in preference order; the command considers the first configured package with a positive approved balance.
- Keep `allow_monetary_charge: false`. A positive approved balance on the selected package is the complete no-charge evidence; the command does not infer it from payment text or controls.
- For your first use, keep `"dry_run": true` exactly. Do not change it yet.

## Run the first dry run

Start with the private request still set to `"dry_run": true`. A dry run may inspect the page and expand `View Details` for existing-enrollment evidence, but it does not change booking fields or submit.

On POSIX shells:

```sh
npm start -- --runtime "$runtime" --policy "$policy" "$request"
```

In PowerShell:

```powershell
npm start -- --runtime $runtime --policy $policy $request
```

Wait for the command to finish, then inspect its result before authorizing any live action.

## Understand the result

Read the completed dry-run result before deciding what to do next. Stdout is the sole machine-readable finalized result channel. A fresh finalization writes one compact JSON object plus a newline; a same-UUID replay emits the exact stored bytes, including existing whitespace, field order, and newline. When no finalized result can be emitted, stderr is the fixed printable line `Booking command failed.`

| Exit | Meaning                                                                             | Operator action                                                                                    |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `0`  | Confirmed booking/waitlist, authoritative existing enrollment, or completed dry run | Read the JSON outcome; do not infer booking from optional metadata                                 |
| `20` | Safe stop before submission                                                         | Correct the request, policy, authentication, or supported page state, then make a deliberate rerun |
| `30` | Command/technical failure                                                           | Use the fixed stderr marker and inspect private runtime evidence                                   |
| `40` | Submission or later processing may have occurred without a finalized success result | Reconcile with Arketa and the durable result; never automatically retry                            |

A dry run reports availability and evidence without submitting; it is not a live outcome. When package evidence applies, `packages_before` records the inventory and its positive-balance/selectability evidence, and `package_selected` identifies the applicable selected package. `google_calendar_url` is optional metadata only for its documented eligible outcomes. Exact Arketa confirmation or authoritative existing-enrollment evidence determines success, not that link or any other optional metadata.

## Recover safely

One UUID owns one journal/result pair. A same request UUID with a finalized result returns that result without opening the browser. Recovery of an incomplete journal before submission finalizes a technical failure; recovery at `SUBMITTING` or later can finalize `CONFIRMATION_UNCERTAIN`.

Uncertainty is not proof of failure. Preserve the durable result and journal, inspect the durable result and Arketa, and only then deliberately choose a new request UUID. The app does not retry automatically; Arketa is authoritative for already-booked and already-waitlisted state. Manually remove a stale runtime lock only after you verify that no booking process is running.

After a finalized `SAFE_STOP`, preserve the original result and evidence, correct the request, policy, authentication, or supported page-state cause, and use a fresh request UUID for any deliberate rerun.

## Authorize one live run

Only after you have inspected a successful dry-run result, preserve the finalized dry-run UUID and evidence. Make these two required live-authorizing edits to the private request: assign a fresh request UUID, then set `dry_run` from `true` to `false`. This creates a new live journal/result pair; reusing the finalized dry-run UUID only replays its dry-run result. The next invocation can perform one external booking or waitlist mutation.

For a live request, Arketa must remain stable throughout the sequential authorization read and until the single submission click. Within that supported stable-page model, the command reads the relevant checkout facts sequentially, applies the required `Myself` attendee selection, preserves a non-empty injuries response or supplies `None` for an empty one, accepts the cancellation policy, and uses the first eligible configured positive-balance package. It permits only the exact requested action. Existing-enrollment inspection may expand `View Details` without submitting. After the one submission click, the command checks only for the matching exact Arketa confirmation; it does not recheck form fields or the URL afterward.

Run the same platform command from the dry run only when you have deliberately made those two edits:

```sh
npm start -- --runtime "$runtime" --policy "$policy" "$request"
```

```powershell
npm start -- --runtime $runtime --policy $policy $request
```

## Troubleshooting

- **Expired authentication:** reopen Arketa with the same dedicated profile, authenticate manually, close the browser, and rerun only after reviewing the request state.
- **Existing runtime lock:** wait for the active command, or manually remove a stale lock only after you verify that no booking process is running.
- **Safe stop (`20`):** preserve the original result and evidence, correct the request, policy, authentication, or supported page state, then use a fresh request UUID before a deliberate rerun; do not add speculative selector fallbacks.
- **Technical failure (`30`):** use `Booking command failed.` as the fixed stderr marker and inspect the private runtime evidence without deleting the journal or result.
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
