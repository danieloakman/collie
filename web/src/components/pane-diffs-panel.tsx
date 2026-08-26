import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { fetchGitDiff, fetchGitStatus, type GitStatusEntry } from "@/lib/api";
import { setStatus } from "@/lib/status";

interface PaneDiffsPanelProps {
  paneId: string;
  session?: string;
}

export function PaneDiffsPanel({ paneId, session }: PaneDiffsPanelProps) {
  const [branch, setBranch] = useState<string | undefined>();
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setDiffPath(null);
    try {
      const res = await fetchGitStatus(paneId, session);
      setBranch(res.branch);
      setEntries(res.entries);
    } catch {
      setStatus("Couldn't read git status", "error");
      setEntries([]);
      setBranch(undefined);
    } finally {
      setLoading(false);
    }
  }, [paneId, session]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const openDiff = async (path: string) => {
    setDiffLoading(true);
    setDiffPath(path);
    try {
      const res = await fetchGitDiff(paneId, { path }, session);
      setDiffText(res.text || "(no unstaged diff — try staged changes on desktop)");
      if (res.truncated) setDiffText((t) => t + "\n\n… truncated");
    } catch {
      // Untracked / pure staged: try staged diff.
      try {
        const res = await fetchGitDiff(paneId, { path, staged: true }, session);
        setDiffText(res.text || "(no diff)");
      } catch {
        setStatus("Couldn't read diff", "error");
        setDiffText("");
      }
    } finally {
      setDiffLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center border-t border-border/40 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border/40">
      <div className="shrink-0 border-b border-border/40 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {branch ? `⎇ ${branch}` : "git"}
        {entries.length === 0 ? " · clean" : ` · ${entries.length} changed`}
      </div>
      {diffPath ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <button
            type="button"
            onClick={() => setDiffPath(null)}
            className="mb-2 text-xs font-medium text-muted-foreground"
          >
            ← Back to status
          </button>
          <div className="mb-2 font-mono text-xs">{diffPath}</div>
          {diffLoading ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {diffText}
            </pre>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={`${e.xy}:${e.path}`}>
              <button
                type="button"
                onClick={() => void openDiff(e.path)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm active:bg-muted/50"
              >
                <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {e.xy.replace(/ /g, "·")}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.path}</span>
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Working tree clean
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
