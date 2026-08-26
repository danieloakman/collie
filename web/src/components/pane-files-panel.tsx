import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, File, Folder, Loader2 } from "lucide-react";

import { fetchFsFile, fetchFsTree, type FsTreeEntry } from "@/lib/api";
import { setStatus } from "@/lib/status";

interface PaneFilesPanelProps {
  paneId: string;
  session?: string;
}

export function PaneFilesPanel({ paneId, session }: PaneFilesPanelProps) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FsTreeEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<string | null>(null);

  const loadTree = useCallback(
    async (p: string) => {
      setLoading(true);
      setFilePath(null);
      setFileText(null);
      setFileMeta(null);
      try {
        const res = await fetchFsTree(paneId, p, session);
        setPath(res.path);
        setEntries(res.entries);
        setTruncated(res.truncated);
      } catch {
        setStatus("Couldn't list files", "error");
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [paneId, session],
  );

  useEffect(() => {
    void loadTree("");
  }, [loadTree]);

  const openEntry = async (e: FsTreeEntry) => {
    if (e.kind === "dir") {
      void loadTree(e.path);
      return;
    }
    if (e.kind !== "file") return;
    setLoading(true);
    try {
      const res = await fetchFsFile(paneId, e.path, session);
      setFilePath(res.path);
      if (res.binary) {
        setFileText(null);
        setFileMeta(`Binary file · ${res.size} bytes`);
      } else {
        setFileText(res.text ?? "");
        setFileMeta(
          `${res.size} bytes${res.truncated ? " · truncated" : ""}`,
        );
      }
    } catch {
      setStatus("Couldn't open file", "error");
    } finally {
      setLoading(false);
    }
  };

  const goUp = () => {
    if (!path) return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    void loadTree(parts.join("/"));
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border/40">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5">
        <button
          type="button"
          onClick={goUp}
          disabled={!path || loading}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted/60 disabled:opacity-40"
          aria-label="Parent folder"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {path || "/"}
        </div>
      </div>
      {loading && !filePath ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : filePath ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setFilePath(null);
              setFileText(null);
            }}
            className="mb-2 text-xs font-medium text-muted-foreground"
          >
            ← Back to folder
          </button>
          <div className="mb-1 font-mono text-xs text-muted-foreground">{filePath}</div>
          {fileMeta && <div className="mb-2 text-[11px] text-muted-foreground">{fileMeta}</div>}
          {fileText !== null ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {fileText}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground">{fileMeta ?? "Binary file"}</div>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                onClick={() => void openEntry(e)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm active:bg-muted/50"
              >
                {e.kind === "dir" ? (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.kind === "file" && e.size !== undefined && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {e.size}
                  </span>
                )}
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">(empty)</li>
          )}
          {truncated && (
            <li className="px-3 py-2 text-center text-xs text-muted-foreground">
              Listing truncated
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
