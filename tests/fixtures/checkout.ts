import type { CheckoutAction } from "../../src/contracts.js";

type BookingPageFixtureAction = CheckoutAction | "book_and_already_booked";

export type BookingPageFixtureOptions = Readonly<{
  action?: BookingPageFixtureAction;
  myselfCount?: number;
  myselfSelected?: boolean;
  injuries?: readonly string[];
  injuriesRequiredMarker?: boolean;
  injuriesType?: string;
  injuriesAriaLabel?: string;
  packageControlCounts?: readonly number[];
  selectedPackageRows?: readonly number[];
  cancellationCount?: number;
  cancellationType?: string;
  cancellationAriaLabel?: string;
  bookedConfirmations?: number;
  waitlistedConfirmations?: number;
  confirmationsHidden?: boolean;
}>;

const SYNTHETIC_PACKAGES = [
  {
    name: "Studio / 10-Class Pack",
    kind: "class_package",
    remaining: "3",
    active: "true"
  },
  {
    name: "Intro / 5-Class Pack",
    kind: "class_package",
    remaining: "1",
    active: "true"
  },
  {
    name: "Grip Socks — Édition limitée",
    kind: "product"
  }
] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function repeated(count: number, render: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => render(index)).join("");
}

function actionHtml(action: BookingPageFixtureAction): string {
  switch (action) {
    case "book":
      return '<button data-testid="action-book" type="button">Book</button>';
    case "waitlist":
      return '<button data-testid="action-waitlist" type="button">Join the waitlist</button>';
    case "sold_out":
      return '<div data-testid="state-sold-out">Sold out</div>';
    case "already_booked":
      return '<div data-testid="state-already-booked">Already booked</div>';
    case "already_waitlisted":
      return '<div data-testid="state-already-waitlisted">Already waitlisted</div>';
    case "book_and_already_booked":
      return `${actionHtml("book")}${actionHtml("already_booked")}`;
  }
}

export function bookingPageHtml(
  options: BookingPageFixtureOptions = {}
): string {
  const action = options.action ?? "book";
  const injuries = options.injuries ?? ["Synthetic existing answer"];
  const packageControlCounts = options.packageControlCounts ?? [1, 1, 0];
  const selectedRows = new Set(options.selectedPackageRows ?? [0]);
  const confirmationVisibility =
    options.confirmationsHidden === false ? "" : " hidden";

  const myself = repeated(
    options.myselfCount ?? 1,
    (index) => `
    <label for="reserve-myself-${index}">Myself</label>
    <input id="reserve-myself-${index}" type="radio" name="reserveFor"${index === 0 && options.myselfSelected !== false ? " checked" : ""}>
  `
  );
  const injuriesHtml = injuries
    .map(
      (value, index) => `
        <label for="injuries-${index}">Do you have any injuries?${options.injuriesRequiredMarker === false ? "" : " *"}</label>
        <input id="injuries-${index}" type="${escapeHtml(options.injuriesType ?? "text")}"${options.injuriesAriaLabel === undefined ? "" : ` aria-label="${escapeHtml(options.injuriesAriaLabel)}"`} value="${escapeHtml(value)}">
      `
    )
    .join("");
  const packageHtml = SYNTHETIC_PACKAGES.map((entry, row) => {
    const controls = repeated(
      packageControlCounts[row] ?? 0,
      (index) => `
      <input
        aria-label="Select ${escapeHtml(entry.name)}"
        type="radio"
        name="package"
        ${selectedRows.has(row) && index === 0 ? "checked" : ""}
      >
    `
    );
    return `
      <div
        data-testid="offering"
        data-kind="${entry.kind}"
        ${
          entry.kind === "class_package"
            ? `data-remaining="${entry.remaining}" data-active="${entry.active}"`
            : ""
        }
      >${escapeHtml(entry.name)}${controls}</div>
    `;
  }).join("");
  const cancellation = repeated(
    options.cancellationCount ?? 1,
    (index) => `
    <label for="cancellation-${index}">I agree to the Cancellation Policy</label>
    <input id="cancellation-${index}" type="${escapeHtml(options.cancellationType ?? "checkbox")}"${options.cancellationAriaLabel === undefined ? "" : ` aria-label="${escapeHtml(options.cancellationAriaLabel)}"`}>
  `
  );
  const booked = repeated(
    options.bookedConfirmations ?? 1,
    () => `
    <div data-testid="confirmation-booked"${confirmationVisibility}>You are Booked!</div>
  `
  );
  const waitlisted = repeated(
    options.waitlistedConfirmations ?? 1,
    () => `
    <div data-testid="confirmation-waitlisted"${confirmationVisibility}>You're on the waitlist</div>
  `
  );

  return `<!doctype html>
    <html>
      <body>
        <div data-testid="authenticated">Signed in as synthetic-private@example.test</div>
        <section data-testid="class">
          <span data-testid="class-name">Reformer – Début ✨</span>
          <span data-testid="instructor">Ana O’Neil</span>
          <span data-testid="class-date">2026-09-01</span>
          <span data-testid="start-time">09:30</span>
          <span data-testid="end-time">10:20</span>
          <span data-testid="timezone">America/Los_Angeles</span>
        </section>
        ${actionHtml(action)}
        ${myself}
        ${injuriesHtml}
        ${packageHtml}
        ${cancellation}
        <label for="marketing">Receive studio updates</label>
        <input id="marketing" type="checkbox">
        ${booked}
        ${waitlisted}
      </body>
    </html>`;
}

export function liveBookingPageHtml(): string {
  return `<!doctype html>
    <html>
      <body>
        <section>
          <h2 class="classTitle">Reformer – Début ✨</h2>
          <p>Tuesday, Sep 1 • 9:30 AM - 10:20 AM PDT</p>
          <p>with Ana O’Neil</p>
        </section>
        <div class="card border-primaryColor" tabindex="0" onclick="this.dataset.clicked = 'true'">
          <h3>⭐ Studio / 10-Class Pack</h3>
          <p>3 remaining</p>
        </div>
        <a href="/shop"><div class="card"><h3>Grip Socks</h3><p>$20</p></div></a>
        <label><input type="radio" name="reserveFor" checked> Myself</label>
        <label for="live-injuries">Do you have any injuries? *</label>
        <input id="live-injuries" type="text" value="">
        <label><input type="checkbox"> I agree to the Cancellation Policy</label>
        <button type="button" onclick="this.dataset.clicked = 'true'">Book</button>
        <div hidden>You are Booked!</div>
        <div hidden>You're on the waitlist</div>
      </body>
    </html>`;
}
