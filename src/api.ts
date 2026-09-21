import type { Comment, Home, Route, Session, Visit, VisitRange } from "./types";

const base =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_BASE_URL || "";
let local = false;
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(base + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-EverOutward": "1",
      ...options.headers,
    },
  });
  const json = await response
    .json()
    .catch(() => ({ error: "The service could not be reached." }));
  if (!response.ok)
    throw new Error(json.error || json.message || "Request failed.");
  return json;
}
export async function session(): Promise<Session> {
  if (!base && !["127.0.0.1", "localhost"].includes(location.hostname))
    return { local: false, owner: false, passwordConfigured: true };
  try {
    const s = await request<Session>("/api/session");
    local = s.local;
    return s;
  } catch {
    return { local: false, owner: false, passwordConfigured: true };
  }
}
export async function state(): Promise<{
  visits: Visit[];
  home: Home | null;
  routes: Route[];
  range?: VisitRange | null;
  queue?: { placeId: string; metres: number; seconds: number }[];
  pendingCount?: number;
  complete?: boolean;
}> {
  if (local) return request("/api/state");
  const response = await fetch("/data/history.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error("The journal could not be loaded. Please retry.");
  const data = await response.json();
  return {
    visits: data.visits || [],
    home: null,
    routes: [],
    range: data.range || null,
    queue: data.queue || [],
    pendingCount: data.pendingCount,
    complete: data.complete,
  };
}
async function cloudComments(): Promise<Comment[]> {
  const records: Comment[] = [];
  let cursor: string | null = null;
  do {
    const response: Response = await fetch(
      `/.herenow/data/comments?limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    if (!response.ok)
      throw new Error("Comments are temporarily unavailable. Please retry.");
    const data: { records: any[]; nextCursor: string | null } =
      await response.json();
    records.push(
      ...data.records.map(
        (r: {
          id: string;
          data: {
            visit_id: string;
            photo_id: string;
            name: string;
            body: string;
          };
          createdAt?: string;
          created_at?: string;
        }) => ({
          id: r.id,
          visitId: r.data.visit_id,
          photoId: r.data.photo_id || null,
          name: r.data.name,
          body: r.data.body,
          createdAt: r.createdAt || r.created_at || "",
        }),
      ),
    );
    cursor = data.nextCursor;
  } while (cursor);
  return records.filter((c) => c.name?.trim() && c.body?.trim());
}
export async function comments(
  visitId: string,
): Promise<{ comments: Comment[]; cloudError?: string }> {
  if (local) return request("/api/comments/" + visitId);
  return {
    comments: (await cloudComments()).filter((c) => c.visitId === visitId),
  };
}
export async function postComment(
  data: {
    visitId: string;
    photoId: string | null;
    name: string;
    body: string;
    website: string;
  },
  key: string,
) {
  if (!data.name.trim() || !data.body.trim())
    throw new Error("Please enter your name and a comment.");
  if (local)
    return request("/api/comments", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(data),
    });
  if (data.website) throw new Error("Please leave the website field empty.");
  const response = await fetch("/.herenow/data/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      visit_id: data.visitId,
      photo_id: data.photoId || "",
      name: data.name.trim(),
      body: data.body.trim(),
    }),
  });
  if (!response.ok) {
    const d = await response.json();
    throw new Error(
      d.message || d.error || "Your comment could not be sent. Please retry.",
    );
  }
}
