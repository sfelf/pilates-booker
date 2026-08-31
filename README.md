# pilates-booker

`pilates-booker` validates one supplied Arketa checkout and can make at most one authorized booking or waitlist submission. It is for a single, deliberate transaction: you supply the checkout and request, review a dry run, and decide whether to allow one live run.

## Safety first

This program does not discover or schedule classes, automate login, solve CAPTCHA or MFA, retry automatically, or guarantee success after uncertainty. It validates the supplied checkout, stops safely when it cannot continue within its supported boundary, and may perform one external booking or waitlist submission only after you set a request to live mode. Arketa remains authoritative for enrollment state.

Keep all private runtime artifacts outside this checkout and out of Git: authenticated browser state, booking URLs, attendee information, injury content, requests, policies, journals, results, screenshots, traces, and live page captures. The tracked configuration files are synthetic examples only.

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

## Keep runtime data private

Create a private base directory outside the checkout. The runtime records journals and results; the profile holds browser authentication; the policy and request are your private configuration files.

On POSIX shells, choose an absolute path outside the repository:

```sh
private_root="/absolute/private/pilates-booker"
runtime="$private_root/runtime"
profile="$runtime/Profile"
policy="$private_root/booking-policy.json"
request="$private_root/booking-request.json"
mkdir -p "$private_root" "$runtime" "$profile"
```

In PowerShell, create the same locations with `Join-Path`:

```powershell
$privateRoot = "C:\private\pilates-booker"
$runtime = Join-Path $privateRoot "runtime"
$profile = Join-Path $runtime "Profile"
$policy = Join-Path $privateRoot "booking-policy.json"
$request = Join-Path $privateRoot "booking-request.json"
New-Item -ItemType Directory -Force $privateRoot | Out-Null
New-Item -ItemType Directory -Force $runtime | Out-Null
New-Item -ItemType Directory -Force $profile | Out-Null
```

Never commit or share these paths or their contents. Do not keep this runtime directory inside the repository.

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

Copy only the tracked synthetic examples into the private paths you created. Run these commands from the repository checkout.

On POSIX shells:

```sh
cp config/booking-policy.example.json "$policy"
cp config/booking-request.example.json "$request"
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

Read the completed dry-run result before deciding what to do next. The command emits its machine-readable result on stdout; do not treat a successful process exit as permission to make a live run without first checking that result against the checkout and request you intended.

## Recover safely

Do not retry automatically or assume an uncertain attempt failed. Preserve the private runtime evidence, inspect the completed result for the request UUID, and reconcile deliberately with Arketa before requesting any new transaction.

## Authorize one live run

Only after you have inspected a successful dry-run result, deliberately change only `dry_run` from `true` to `false` in the private request. Keep the same UUID for that authorized transaction; for a new transaction, use and retain a new transaction UUID. The next invocation can perform one external booking or waitlist mutation.

For a live request, the supported stable-page model reads the relevant checkout facts sequentially, applies the required `Myself` attendee selection, preserves a non-empty injuries response or supplies `None` for an empty one, accepts the cancellation policy, and uses the first eligible configured positive-balance package. It permits only the exact requested action. Existing-enrollment inspection may expand `View Details` without submitting. After the one submission click, the command checks only for the matching Arketa booking or waitlist confirmation; it does not recheck form fields or the URL afterward.

Run the same platform command from the dry run only when you have deliberately made that one request edit:

```sh
npm start -- --runtime "$runtime" --policy "$policy" "$request"
```

```powershell
npm start -- --runtime $runtime --policy $policy $request
```

## Troubleshooting

- If authentication expires, reopen Arketa with the same dedicated profile, authenticate manually, close the browser, and rerun only after reviewing the request state.
- If the checkout is unsupported or has changed, stop rather than adding speculative workarounds.
- Keep private runtime artifacts out of tickets, commits, and public diagnostics.

## Development validation

After `npm ci`, repository checks that do not access a browser profile are:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

## Architecture and safety reference

- [Architecture](docs/architecture.md) describes components, data flow, state transitions, and the result model.
- [Safety boundaries](docs/safety-boundaries.md) describes trusted inputs, booking authorization, guarantees, non-guarantees, and supported checkout assumptions.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.
