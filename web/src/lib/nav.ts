// Route path helpers. Pane ids contain a colon (e.g. "wE:p2"), so they must be URL-encoded in the
// path; React Router decodes them back in useParams. The active session rides along as `?s=` so a
// navigation stays scoped to the session you're viewing (see lib/session.ts) — omitted on primary.
import { FEATURE_TAB_PARAM, type FeatureTab } from "./feature-tab";
import { SESSION_PARAM, normalizeSession, sessionSearch } from "./session";

/** Compose `?s=` and optional `?tab=` for a pane detail navigation. */
export function paneSearch(session?: string, featureTab: FeatureTab = "chat"): string {
  const parts: string[] = [];
  const s = normalizeSession(session);
  if (s) parts.push(`${SESSION_PARAM}=${encodeURIComponent(s)}`);
  if (featureTab !== "chat") parts.push(`${FEATURE_TAB_PARAM}=${featureTab}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function panePath(paneId: string, session?: string, featureTab?: FeatureTab): string {
  return `/pane/${encodeURIComponent(paneId)}${paneSearch(session, featureTab ?? "chat")}`;
}

/**
 * A pane's conversation history — redirects to the Chat feature tab (transcript is inlined there).
 * Kept as a path helper so old `/history` links and bookmarks still resolve.
 */
export function historyPath(paneId: string, session?: string): string {
  const base = sessionSearch(session);
  const params = new URLSearchParams(base.startsWith("?") ? base.slice(1) : base);
  // Chat is the default tab — no `tab=` needed.
  const qs = params.toString();
  return `/pane/${encodeURIComponent(paneId)}${qs ? `?${qs}` : ""}`;
}

/** A space's detail route (its tabs + panes). Deep-linkable; carries the session like panePath. */
export function spacePath(spaceId: string, session?: string): string {
  return `/space/${encodeURIComponent(spaceId)}${sessionSearch(session)}`;
}

/** The dashboard path, carrying the current session so "go home" doesn't drop you back to primary. */
export function homePath(session?: string): string {
  return `/${sessionSearch(session)}`;
}

/** The settings route, carrying the current session like the other path helpers. */
export function settingsPath(session?: string): string {
  return `/settings${sessionSearch(session)}`;
}
