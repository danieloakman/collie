// Route path helpers. Pane ids contain a colon (e.g. "wE:p2"), so they must be URL-encoded in the
// path; React Router decodes them back in useParams. The active session rides along as `?s=` so a
// navigation stays scoped to the session you're viewing (see lib/session.ts) — omitted on primary.
import { sessionSearch } from "./session";

export function panePath(paneId: string, session?: string): string {
  return `/pane/${encodeURIComponent(paneId)}${sessionSearch(session)}`;
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
