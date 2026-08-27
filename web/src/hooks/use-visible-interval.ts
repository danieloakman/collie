import { useEffect, useRef } from "react";

import { isLocked } from "@/lib/idle";

// Cadence for workspace FS / git panels (Files, Diffs). Matches the hot pane poll so an open
// Diffs tab tracks the agent writing files without a separate "refresh" gesture.
export const VISIBLE_POLL_MS = 1500;

/**
 * Fire `tick` on an interval while the page is visible and Collie isn't idle-locked.
 * Also kicks immediately on focus / online / becoming visible — same wake model as `usePolling`,
 * so a phone that slept with Diffs open catches up the moment you look again.
 */
export function useVisibleInterval(tick: () => void, ms: number = VISIBLE_POLL_MS): void {
  const ref = useRef(tick);
  ref.current = tick;

  useEffect(() => {
    const run = () => {
      if (document.hidden) return;
      if (isLocked()) return;
      ref.current();
    };
    const id = window.setInterval(run, ms);
    const onWake = () => run();
    const onVisible = () => {
      if (!document.hidden) run();
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms]);
}
