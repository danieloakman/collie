import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { ChatMessageList, type ChatMessageListHandle } from "@/components/ui/chat/chat-message-list";
import { TranscriptView } from "@/components/transcript-view";
import { fetchHistory } from "@/lib/api";
import { HISTORY_PAGE_SIZE } from "@/lib/loaders";
import { setStatus } from "@/lib/status";
import type { AgentStatus, TranscriptEntry } from "@/lib/types";

const INITIAL_RENDER = 60;
const RENDER_STEP = 120;
const GROW_THRESHOLD = 800;

interface PaneChatPanelProps {
  paneId: string;
  session?: string;
  /** When this changes (e.g. idle→working→done), refresh the transcript tail. */
  agentStatus?: AgentStatus;
  hasSession?: boolean;
}

/**
 * Transcript-first chat surface for the Chat feature tab. History comes from the agent's journal
 * (not the PTY mirror). Composer stays in AgentChat below this panel.
 */
export function PaneChatPanel({ paneId, session, agentStatus, hasSession }: PaneChatPanelProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [renderCount, setRenderCount] = useState(INITIAL_RENDER);
  const listRef = useRef<ChatMessageListHandle>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const pendingRestore = useRef(false);
  const following = useRef(true);
  const paneRef = useRef(paneId);
  paneRef.current = paneId;

  const loadNewest = useCallback(
    async (signal?: AbortSignal) => {
      const forPane = paneId;
      if (!hasSession) {
        setUnavailable("no-session");
        setEntries([]);
        setLoading(false);
        return;
      }
      try {
        const res = await fetchHistory(
          forPane,
          { limit: HISTORY_PAGE_SIZE },
          session,
          signal,
        );
        if (forPane !== paneRef.current) return;
        if (!res.available) {
          setUnavailable(res.reason ?? "no-log");
          setEntries([]);
          setHasMore(false);
          return;
        }
        setUnavailable(null);
        setEntries(res.entries);
        setHasMore(res.hasMore);
        setRenderCount(INITIAL_RENDER);
        if (following.current) {
          queueMicrotask(() => listRef.current?.scrollToBottom());
        }
      } catch (e) {
        if (forPane !== paneRef.current) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setUnavailable("error");
      } finally {
        if (forPane === paneRef.current) setLoading(false);
      }
    },
    [hasSession, paneId, session],
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setUnavailable(null);
    setEntries([]);
    setHasMore(false);
    following.current = true;
    void loadNewest(ac.signal);
    return () => ac.abort();
  }, [loadNewest]);

  // Refresh when the agent finishes a turn / goes blocked — not on every 1.5s poll.
  useEffect(() => {
    if (!agentStatus) return;
    if (agentStatus === "working") return; // wait until idle/blocked/done for a cheaper refresh
    void loadNewest();
  }, [agentStatus, loadNewest]);

  const shown = useMemo(
    () =>
      renderCount >= entries.length ? entries : entries.slice(entries.length - renderCount),
    [entries, renderCount],
  );
  const allRendered = renderCount >= entries.length;

  const captureAnchor = () => {
    const el = listRef.current?.getScrollElement();
    anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    pendingRestore.current = true;
  };

  const loadOlder = useCallback(async () => {
    const oldest = entries[0]?.uuid;
    if (loadingOlder || !hasMore || !oldest) return;
    captureAnchor();
    setLoadingOlder(true);
    const forPane = paneId;
    try {
      const res = await fetchHistory(forPane, { limit: HISTORY_PAGE_SIZE, before: oldest }, session);
      if (forPane !== paneRef.current) return;
      if (!res.available) {
        setHasMore(false);
        return;
      }
      setEntries((prev) => [...res.entries, ...prev]);
      setRenderCount((c) => c + res.entries.length);
      setHasMore(res.hasMore);
    } catch {
      if (forPane !== paneRef.current) return;
      setStatus("Couldn't load older history", "error");
    } finally {
      if (forPane === paneRef.current) setLoadingOlder(false);
    }
  }, [entries, hasMore, loadingOlder, paneId, session]);

  const growUpward = useCallback(() => {
    if (!allRendered) {
      captureAnchor();
      setRenderCount((c) => Math.min(c + RENDER_STEP, entries.length));
      return;
    }
    if (hasMore) void loadOlder();
  }, [allRendered, entries.length, hasMore, loadOlder]);

  useEffect(() => {
    const el = listRef.current?.getScrollElement();
    if (!el) return;
    const onScroll = () => {
      following.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
      if (el.scrollTop < GROW_THRESHOLD && !loadingOlder) growUpward();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [growUpward, loadingOlder]);

  useLayoutEffect(() => {
    if (!pendingRestore.current) return;
    pendingRestore.current = false;
    const a = anchor.current;
    const el = listRef.current?.getScrollElement();
    if (a && el) el.scrollTop = a.top + (el.scrollHeight - a.height);
    anchor.current = null;
  }, [shown]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (unavailable) {
    const copy: Record<string, string> = {
      disabled: "Transcript history is switched off on this bridge.",
      "no-session": "No agent session on this pane — use Live, or start an agent.",
      "no-log": "No transcript file found for this session yet.",
      error: "Couldn't read the transcript.",
    };
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {copy[unavailable] ?? copy.error}
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 border-t border-border/40">
      <ChatMessageList ref={listRef} dep={entries.length} className="px-2 py-3">
        {(hasMore || !allRendered) && (
          <button
            type="button"
            onClick={() => growUpward()}
            disabled={loadingOlder}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50 disabled:opacity-60"
          >
            {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {loadingOlder ? "Loading…" : "Load older"}
          </button>
        )}
        <TranscriptView entries={shown} />
      </ChatMessageList>
    </div>
  );
}
