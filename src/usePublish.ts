import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";

export type PublishJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  message?: string;
  error?: string;
  result?: {
    siteUrl: string;
    publishedAt: string;
    pendingLocalChanges?: boolean;
    publishedVisitCount: number;
    warnings?: string[];
  };
};
export type SiteInfo = { siteUrl: string | null; publishedAt: string | null };
export type Publisher = ReturnType<typeof usePublish>;

/**
 * Follows the owner's here.now publishing job so the header and Workspace
 * share one status, and starts new publishes.
 */
export function usePublish(enabled: boolean, onFinished: () => Promise<void>) {
  const [job, setJob] = useState<PublishJob | null>(null),
    [site, setSite] = useState<SiteInfo>({ siteUrl: null, publishedAt: null }),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState("");
  const finished = useRef(""),
    refresh = useRef(onFinished);
  refresh.current = onFinished;
  useEffect(() => {
    if (!enabled) return;
    api
      .request<SiteInfo>("/api/site")
      .then(setSite)
      .catch(() => {});
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    /** Reads the latest job, refreshing the journal once a new publish succeeds. */
    const poll = async () => {
      try {
        const { job: current } = await api.request<{ job: PublishJob | null }>(
          "/api/publish",
        );
        if (cancelled) return;
        setJob(current);
        setConnectionError("");
        if (current?.status === "succeeded" && current.result) {
          setSite(current.result);
          if (finished.current !== current.id) {
            finished.current = current.id;
            await refresh.current();
          }
        }
      } catch {
        if (!cancelled)
          setConnectionError(
            "Cannot reach the local server. Reconnecting to check publishing status…",
          );
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  /** Starts a publish; progress arrives through polling. */
  const publish = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = await api.request<{ job: PublishJob }>("/api/publish", {
        method: "POST",
      });
      setJob(result.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, []);
  return {
    job,
    site,
    busy: submitting || job?.status === "running",
    failed: !!error || job?.status === "failed",
    error: error || job?.error || "",
    connectionError,
    publish,
  };
}
