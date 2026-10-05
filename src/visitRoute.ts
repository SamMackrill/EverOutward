import type { Visit } from "./types";

/** A generated visit page opens its visit; explicit hash routes still take precedence. */
export function currentView(visits: Visit[] = []) {
  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  const visitId =
    visits.find((v) => v.sharePath === location.pathname)?.id ||
    (canonical && new URL(canonical.href).pathname === location.pathname
      ? document.querySelector<HTMLMetaElement>('meta[name="eo:visit-id"]')
          ?.content
      : undefined);
  return location.hash.slice(1) || (visitId ? "visit/" + visitId : "map");
}
