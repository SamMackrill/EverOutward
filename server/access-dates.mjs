import { limitedAccess } from "./access-rules.mjs";

export const ACCESS_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_PAGE_BYTES = 2_000_000;

export const accessToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/** Read only the official property's embedded calendar, never unrelated dates. */
export function parseAccessDates(html, rule, today = accessToday()) {
  const script = html.match(
    /<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!script)
    throw new Error(
      "The official opening calendar could not be read. Check the official page.",
    );
  const data = JSON.parse(script[1]);
  const days =
    data?.props?.pageProps?.appContext?.place?.data?._embedded?.opening?.days;
  if (
    !days ||
    typeof days !== "object" ||
    Array.isArray(days) ||
    !Object.keys(days).length
  )
    throw new Error(
      "The official opening calendar is unavailable. Check the official page.",
    );
  const dates = [];
  for (const [date, day] of Object.entries(days)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
      new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
    )
      throw new Error(
        "The official calendar returned an unrecognised date format.",
      );
    if (date < today) continue;
    if (
      !day ||
      !["FULLY_OPEN", "PARTIALLY_OPEN", "CLOSED", "NO_DATA"].includes(
        day.status,
      )
    )
      throw new Error(
        "The official calendar returned an unrecognised opening status.",
      );
    if (
      !day ||
      typeof day !== "object" ||
      !["FULLY_OPEN", "PARTIALLY_OPEN"].includes(day.status)
    )
      continue;
    const assets = (Array.isArray(day.assets) ? day.assets : []).filter(
      (asset) =>
        rule.assets.includes(asset.name) &&
        /^\d{1,2}:\d{2}$/.test(asset.opensAt) &&
        /^\d{1,2}:\d{2}$/.test(asset.closesAt),
    );
    if (!assets.length) continue;
    dates.push({
      date,
      hours: assets
        .map((a) => `${a.name}: ${a.opensAt}–${a.closesAt}`)
        .join("; "),
    });
  }
  return dates.sort((a, b) => a.date.localeCompare(b.date));
}

async function officialPage(url, fetcher) {
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.hostname !== "www.nationaltrust.org.uk"
    )
      throw new Error(
        "The official page redirected outside the National Trust website.",
      );
    const response = await fetcher(target.href, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "EverOutward/0.1 (daily visitor opening-date checks)",
        Accept: "text/html",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new Error("The official page redirected without a destination.");
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `The official page could not be checked (HTTP ${response.status}).`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The official page returned no content.");
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_PAGE_BYTES)
          throw new Error("The official page was too large to check.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("The official page redirected too many times.");
}

/** Sanitise a captured set of calendar records for API responses and publishing. */
export function accessEntries(
  savedEntries,
  places,
  { now = new Date(), rules = limitedAccess } = {},
) {
  const today = accessToday(now);
  const savedById = new Map(
    savedEntries.map((entry) => [entry.placeId, entry]),
  );
  return Object.entries(rules)
    .filter(([id]) => places.some((p) => p.id === id))
    .map(([placeId, rule]) => {
      const saved = savedById.get(placeId) || {};
      return {
        placeId,
        source: rule.source,
        dates: (saved.dates || []).filter((d) => d.date >= today),
        newDates: (saved.newDates || []).filter((d) => d >= today),
        checkedAt: saved.checkedAt || null,
        attemptedAt: saved.attemptedAt || null,
        nextCheckAt: saved.attemptedAt
          ? new Date(
              Date.parse(saved.attemptedAt) + ACCESS_CHECK_INTERVAL,
            ).toISOString()
          : null,
        error: saved.error || null,
      };
    });
}

/** Persist successes, failures and unread dates across browser/server restarts. */
export function createAccessMonitor({
  store,
  places,
  fetcher = fetch,
  now = () => new Date(),
  rules = limitedAccess,
}) {
  const watched = Object.entries(rules).filter(([id]) =>
    places.some((p) => p.id === id),
  );
  let running = null;
  const entries = () =>
    accessEntries(store.list("accessDates"), places, { now: now(), rules });
  const check = (force = false) => {
    if (running) return running;
    running = (async () => {
      for (const [placeId, rule] of watched) {
        const old = store.get("accessDates", placeId) || {};
        const at = now();
        // Even explicit checks are bounded; failures never cause a retry loop.
        if (
          old.attemptedAt &&
          at.getTime() - Date.parse(old.attemptedAt) <
            (force ? 60_000 : ACCESS_CHECK_INTERVAL)
        )
          continue;
        const attemptedAt = at.toISOString();
        try {
          const dates = parseAccessDates(
            await officialPage(rule.source, fetcher),
            rule,
            accessToday(at),
          );
          // Acknowledgements made while the page was loading must stay saved.
          const latest = store.get("accessDates", placeId) || {};
          const seen = new Set(latest.seenDates || []);
          const added = dates.map((d) => d.date).filter((d) => !seen.has(d));
          const available = new Set(dates.map((d) => d.date));
          store.put("accessDates", placeId, {
            placeId,
            dates,
            newDates: [...new Set([...(latest.newDates || []), ...added])]
              .filter((d) => available.has(d))
              .sort(),
            seenDates: [...new Set([...seen, ...available])].sort(),
            checkedAt: attemptedAt,
            attemptedAt,
            error: null,
          });
        } catch (error) {
          store.put("accessDates", placeId, {
            ...(store.get("accessDates", placeId) || {}),
            placeId,
            attemptedAt,
            error:
              error instanceof Error
                ? error.message
                : "Opening dates could not be checked.",
          });
        }
      }
      return entries();
    })().finally(() => {
      running = null;
    });
    return running;
  };
  const acknowledge = (placeId, dates) => {
    const old = store.get("accessDates", placeId);
    if (!watched.some(([id]) => id === placeId))
      throw new Error("Choose a monitored place.");
    if (old)
      store.put("accessDates", placeId, {
        ...old,
        newDates: (old.newDates || []).filter((d) => !dates.includes(d)),
      });
    return entries();
  };
  const start = () => {
    void check();
    const timer = setInterval(() => {
      void check();
    }, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  };
  return { entries, check, acknowledge, start };
}
