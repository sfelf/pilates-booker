export type CalendarFixtureClass = Readonly<{
  name: string;
  date: string;
  time: string;
  href?: string;
  linkCount?: number;
  extraHrefs?: readonly string[];
  hiddenLink?: boolean;
}>;

export type CalendarFixtureOptions = Readonly<{
  classes?: readonly CalendarFixtureClass[];
  startWeek?: string;
  nextControl?: "missing" | "duplicate" | "disabled";
  navigation?: "advances" | "unchanged";
  incompleteWeeks?: readonly number[];
  hydrateAfterMs?: number;
  extraRegion?: boolean;
  navigationRegionDelayMs?: number;
  malformedRange?: boolean;
}>;

export function calendarPageHtml(options: CalendarFixtureOptions = {}): string {
  const classes = options.classes ?? [];
  const startWeek = options.startWeek ?? "2026-09-06";
  const nextControl = options.nextControl;
  const navigation = options.navigation ?? "advances";
  const incompleteWeeks = new Set(options.incompleteWeeks ?? []);
  const hydrateAfterMs = options.hydrateAfterMs ?? 0;
  const extraRegion = options.extraRegion ?? false;
  const navigationRegionDelayMs = options.navigationRegionDelayMs ?? 0;
  const malformedRange = options.malformedRange ?? false;
  const encodedClasses = JSON.stringify(classes).replaceAll("<", "\\u003c");

  return `<!doctype html>
    <html>
      <body data-calendar-navigation-clicks="0" data-calendar-checkout-clicks="0">
        <main id="calendar"></main>
        <script>
          const classes = ${encodedClasses};
          const startWeek = ${JSON.stringify(startWeek)};
          const navigation = ${JSON.stringify(navigation)};
          const nextControl = ${JSON.stringify(nextControl)};
          const incompleteWeeks = new Set(${JSON.stringify([...incompleteWeeks])});
          const extraRegion = ${JSON.stringify(extraRegion)};
          const navigationRegionDelayMs = ${JSON.stringify(navigationRegionDelayMs)};
          const malformedRange = ${JSON.stringify(malformedRange)};
          let offset = 0;

          const escapeHtml = (value) => value
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
          const addDays = (isoDate, days) => {
            const date = new Date(isoDate + "T12:00:00Z");
            date.setUTCDate(date.getUTCDate() + days);
            return date.toISOString().slice(0, 10);
          };
          const ordinal = (day) => {
            if (day % 100 >= 11 && day % 100 <= 13) return day + "th";
            return day + ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
          };
          const dateLabel = (isoDate) => {
            const date = new Date(isoDate + "T12:00:00Z");
            const weekday = new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              timeZone: "UTC"
            }).format(date);
            const month = new Intl.DateTimeFormat("en-US", {
              month: "short",
              timeZone: "UTC"
            }).format(date);
            return weekday + " " + month + " " + ordinal(date.getUTCDate());
          };
          const rangeLabel = (weekStart) => {
            if (malformedRange) return "Unavailable";
            const start = new Date(weekStart + "T12:00:00Z");
            const end = new Date(addDays(weekStart, 6) + "T12:00:00Z");
            const month = (date) => new Intl.DateTimeFormat("en-US", {
              month: "long",
              timeZone: "UTC"
            }).format(date);
            return month(start) + " " + start.getUTCDate() + " — " +
              month(end) + " " + end.getUTCDate();
          };
          const checkoutLinks = (entry) => {
            const extraHrefs = entry.extraHrefs ?? [];
            if (entry.href === undefined && extraHrefs.length === 0) return "";
            const count = entry.linkCount ?? 1;
            const hrefs = entry.href === undefined
              ? extraHrefs
              : [...Array.from({ length: count }, () => entry.href), ...extraHrefs];
            return hrefs.map((href) =>
              '<a class="calendar-view__cell-cta btn btn-primary primaryColor"' +
                (entry.hiddenLink ? ' style="display:none"' : '') +
                ' data-calendar-checkout href="' +
                escapeHtml(href) + '">View class</a>'
            ).join("");
          };
          const cell = (entry) =>
            '<article class="calendar-view__cell" aria-label="' +
              escapeHtml(entry.name + " — " + entry.time) + '">' +
              '<header>' +
                '<div class="calendar-view__cell-start-time">' + escapeHtml(entry.time) + '</div>' +
                '<div class="calendar-view__cell-name">' + escapeHtml(entry.name) + '</div>' +
                '<div class="calendar-view__cell-host">with Synthetic Instructor</div>' +
                '<div class="calendar-view__cell-location">Synthetic Studio</div>' +
              '</header><footer>' + checkoutLinks(entry) + '</footer>' +
            '</article>';
          const render = () => {
            const weekStart = addDays(startWeek, offset * 7);
            const dayCount = incompleteWeeks.has(offset) ? 6 : 7;
            const columns = Array.from({ length: dayCount }, (_, dayOffset) => {
              const date = addDays(weekStart, dayOffset);
              const articles = classes.filter((entry) => entry.date === date).map(cell).join("");
              return '<section class="calendar-view__column" aria-label="' +
                dateLabel(date) + '">' + articles + '</section>';
            }).join("");
            const previous = '<div class="d-flex flex-column justify-content-center week-range__arrow">' +
              '<svg><path d="M5.88 4.12L13.76 12l-7.88 7.88L8 22l10-10L8 2z"></path></svg></div>';
            const next = nextControl === "missing" ? "" : Array.from(
              { length: nextControl === "duplicate" ? 2 : 1 },
              () => '<div class="d-flex flex-column justify-content-center week-range__arrow' +
                (nextControl === "disabled" ? " week-range--disabled" : "") + '">' +
                '<svg><path d="M5.88 4.12L13.76 12l-7.88 7.88L8 22l10-10L8 2z"></path></svg></div>'
            ).join("");
            document.querySelector("#calendar").innerHTML =
              '<div class="week-range">' + previous +
                '<div class="week-range__meta">' + rangeLabel(weekStart) + '</div>' + next +
                '<div class="d-flex week-range__list"><div class="calendar-view d-flex flex-row">' +
                  columns +
                '</div></div>' +
              '</div>' +
              (extraRegion ? '<aside aria-label="Synthetic notice">Notice</aside>' : '');
            document.querySelectorAll(".week-range__meta + .week-range__arrow").forEach((arrow) => {
              arrow.addEventListener("click", () => {
                if (arrow.classList.contains("week-range--disabled")) return;
                document.body.dataset.calendarNavigationClicks = String(
                  Number(document.body.dataset.calendarNavigationClicks) + 1
                );
                if (navigation === "advances") offset += 1;
                if (navigationRegionDelayMs > 0) {
                  document.querySelector(".week-range__meta").textContent = rangeLabel(
                    addDays(startWeek, offset * 7)
                  );
                  document.querySelector(".week-range").insertAdjacentHTML(
                    "beforeend",
                    '<div class="spinner-border spinner-border-sm"></div>'
                  );
                  setTimeout(render, navigationRegionDelayMs);
                } else {
                  render();
                }
              });
            });
            document.querySelectorAll("[data-calendar-checkout]").forEach((link) => {
              link.addEventListener("click", (event) => {
                event.preventDefault();
                document.body.dataset.calendarCheckoutClicks = String(
                  Number(document.body.dataset.calendarCheckoutClicks) + 1
                );
              });
            });
          };
          setTimeout(render, ${hydrateAfterMs});
        </script>
      </body>
    </html>`;
}
