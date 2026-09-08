export type CalendarFixtureClass = Readonly<{
  name: string;
  date: string;
  time: string;
  href?: string;
  linkCount?: number;
}>;

export type CalendarFixtureOptions = Readonly<{
  classes?: readonly CalendarFixtureClass[];
  startWeek?: string;
  nextControl?: "missing" | "duplicate" | "disabled";
  navigation?: "advances" | "unchanged";
  incompleteWeeks?: readonly number[];
  hydrateAfterMs?: number;
}>;

export function calendarPageHtml(options: CalendarFixtureOptions = {}): string {
  const classes = options.classes ?? [];
  const startWeek = options.startWeek ?? "2026-09-07";
  const nextControl = options.nextControl;
  const navigation = options.navigation ?? "advances";
  const incompleteWeeks = new Set(options.incompleteWeeks ?? []);
  const hydrateAfterMs = options.hydrateAfterMs ?? 0;
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
          const checkoutLinks = (entry) => {
            if (entry.href === undefined) return "";
            const count = entry.linkCount ?? 1;
            return Array.from({ length: count }, () =>
              '<a data-calendar-checkout href="' + escapeHtml(entry.href) + '">View class</a>'
            ).join("");
          };
          const render = () => {
            const weekStart = addDays(startWeek, offset * 7);
            const dayCount = incompleteWeeks.has(offset) ? 6 : 7;
            const regions = Array.from({ length: dayCount }, (_, dayOffset) => {
              const date = addDays(weekStart, dayOffset);
              const articles = classes.filter((entry) => entry.date === date).map((entry) =>
                '<article aria-label="Class">' +
                  '<h2>' + escapeHtml(entry.name) + '</h2>' +
                  '<time>' + escapeHtml(entry.time) + '</time>' +
                  checkoutLinks(entry) +
                '</article>'
              ).join("");
              return '<section role="region" aria-label="' + date + '">' + articles + '</section>';
            }).join("");
            const next = nextControl === "missing" ? "" : Array.from(
              { length: nextControl === "duplicate" ? 2 : 1 },
              () => '<button type="button" aria-label="Next week"' +
                (nextControl === "disabled" ? " disabled" : "") +
                '>Next week</button>'
            ).join("");
            document.querySelector("#calendar").innerHTML =
              '<h1 id="calendar-week-heading">Week of ' + weekStart + '</h1>' + regions + next;
            document.querySelectorAll('[aria-label="Next week"]').forEach((button) => {
              button.addEventListener("click", () => {
                document.body.dataset.calendarNavigationClicks = String(
                  Number(document.body.dataset.calendarNavigationClicks) + 1
                );
                if (navigation === "advances") offset += 1;
                render();
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
