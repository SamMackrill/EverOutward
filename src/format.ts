/** Converts metres to miles with one decimal place. */
export const miles = (m: number) => (m / 1609.344).toFixed(1);
/** Formats a duration as minutes or as hours and remaining minutes. */
export const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
    : `${Math.round(seconds / 60)} min`;
/** Formats an ISO date as a short British date, e.g. "15 Mar 2026". */
export const shortDate = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
/** Formats an ISO date as a long British date without timezone drift. */
export const date = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const ordinals = ["th", "st", "nd", "rd"];
export const ordinal = (n: number) =>
  n + (ordinals[(n % 100) - 20 > 0 ? (n % 100) % 10 : n % 100] || "th");
