// Workspace-scoped filesystem + git reads for the Files / Diffs tabs.
//
// SECURITY (same posture as bridge/journal/files.ts):
//  - The client never supplies an absolute root. The pane's cwd (from the live snapshot) is the
//    only anchor; optionally widened to the git toplevel when cwd sits inside a repo.
//  - Relative paths from the client are joined under that root, then re-checked with
//    containedRealpath after symlink resolution.
//  - Reads are byte-capped; binaries are refused (metadata only).

import { spawn } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { containedRealpath } from "./journal/files.ts";

/** Most bytes we will ever return for one file view. */
export const MAX_FILE_BYTES = 512 * 1024; // 512 KB

/** Max entries returned for one directory listing. */
export const MAX_TREE_ENTRIES = 500;

export type FsEntryKind = "dir" | "file" | "other";

export interface FsTreeEntry {
  name: string;
  path: string; // relative to workspace root, posix-ish (forward slashes)
  kind: FsEntryKind;
  size?: number;
}

export interface FsTreeResult {
  root: string; // absolute workspace root (for bridge logs only — not required by UI)
  path: string; // relative path listed
  entries: FsTreeEntry[];
  truncated: boolean;
}

export interface FsFileResult {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  text?: string;
}

export interface GitStatusEntry {
  path: string;
  /** Two-letter porcelain XY status, e.g. " M", "M ", "??". */
  xy: string;
}

export interface GitStatusResult {
  root: string;
  branch?: string;
  entries: GitStatusEntry[];
}

export interface GitDiffResult {
  root: string;
  path?: string;
  staged: boolean;
  text: string;
  truncated: boolean;
}

/** Join + realpath-contain `rel` under `root`. Empty / "." → the root itself. */
export async function resolveUnderRoot(root: string, rel: string): Promise<string | null> {
  const cleaned = sanitizeRel(rel);
  if (cleaned === null) return null;
  const candidate = cleaned === "" ? root : resolve(root, cleaned);
  return containedRealpath(candidate, root);
}

/**
 * Reject absolute paths, `..` segments, and NUL. Returns "" for the root, or a normalised relative
 * path using the platform separator (callers re-encode for the wire).
 */
export function sanitizeRel(rel: string | null | undefined): string | null {
  if (rel === null || rel === undefined) return "";
  const raw = rel.trim();
  if (raw === "" || raw === ".") return "";
  if (raw.includes("\0")) return null;
  // Absolute (posix or windows) — never accept as client input.
  if (raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw)) return null;
  const parts = raw.replace(/\\/g, "/").split("/");
  if (parts.some((p) => p === ".." || p === "")) return null;
  return parts.join(sep);
}

function toWirePath(root: string, abs: string): string {
  const rel = relative(root, abs);
  return rel === "" ? "" : rel.split(sep).join("/");
}

/**
 * Resolve the workspace root for a pane cwd: git toplevel when cwd is inside a repo, else the cwd
 * itself. Both sides are realpath'd.
 */
export async function workspaceRootForCwd(cwd: string): Promise<string | null> {
  const realCwd = await realpath(cwd).catch(() => null);
  if (realCwd === null) return null;
  const top = await gitToplevel(realCwd);
  if (top !== null) {
    const contained = await containedRealpath(realCwd, top);
    if (contained !== null) return top;
  }
  return realCwd;
}

async function gitToplevel(cwd: string): Promise<string | null> {
  const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (out === null) return null;
  const line = out.trim();
  if (!line) return null;
  return realpath(line).catch(() => null);
}

export async function listTree(root: string, rel: string): Promise<FsTreeResult | null> {
  const abs = await resolveUnderRoot(root, rel);
  if (abs === null) return null;
  let st;
  try {
    st = await stat(abs);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;

  let names: string[];
  try {
    names = await readdir(abs);
  } catch {
    return null;
  }
  names.sort((a, b) => a.localeCompare(b));
  const truncated = names.length > MAX_TREE_ENTRIES;
  const slice = truncated ? names.slice(0, MAX_TREE_ENTRIES) : names;
  const entries: FsTreeEntry[] = [];
  for (const name of slice) {
    const child = join(abs, name);
    const childReal = await containedRealpath(child, root);
    if (childReal === null) continue;
    let kind: FsEntryKind = "other";
    let size: number | undefined;
    try {
      const cst = await stat(childReal);
      if (cst.isDirectory()) kind = "dir";
      else if (cst.isFile()) {
        kind = "file";
        size = cst.size;
      }
    } catch {
      continue;
    }
    entries.push({
      name: basename(childReal),
      path: toWirePath(root, childReal),
      kind,
      ...(size !== undefined ? { size } : {}),
    });
  }
  // Directories first, then files — easier thumb scrolling on a phone.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === "dir") return -1;
      if (b.kind === "dir") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  return {
    root,
    path: toWirePath(root, abs),
    entries,
    truncated,
  };
}

export async function readWorkspaceFile(root: string, rel: string): Promise<FsFileResult | null> {
  const abs = await resolveUnderRoot(root, rel);
  if (abs === null) return null;
  let st;
  try {
    st = await stat(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const size = st.size;
  const buf = await readFile(abs);
  const slice = buf.subarray(0, Math.min(buf.length, MAX_FILE_BYTES));
  const truncated = buf.length > MAX_FILE_BYTES;
  if (isBinary(slice)) {
    return { path: toWirePath(root, abs), size, truncated, binary: true };
  }
  return {
    path: toWirePath(root, abs),
    size,
    truncated,
    binary: false,
    text: slice.toString("utf8"),
  };
}

/** NUL in the first chunk → treat as binary (same heuristic as git). */
function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function gitStatus(root: string): Promise<GitStatusResult | null> {
  const branchOut = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = await runGit(root, ["status", "--porcelain=v1", "-u"]);
  if (porcelain === null) return null;
  const entries: GitStatusEntry[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let path = line.slice(3);
    // Rename: "R  old -> new" — show the new path.
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"')) {
      // Best-effort: strip quotes; full C-unescape is unnecessary for the UI list.
      path = path.slice(1, -1);
    }
    entries.push({ path, xy });
  }
  return {
    root,
    ...(branchOut?.trim() ? { branch: branchOut.trim() } : {}),
    entries,
  };
}

export async function gitDiff(
  root: string,
  opts: { path?: string; staged?: boolean } = {},
): Promise<GitDiffResult | null> {
  const args = ["diff", "--no-color"];
  if (opts.staged) args.push("--cached");
  if (opts.path) {
    const abs = await resolveUnderRoot(root, opts.path);
    if (abs === null) return null;
    // Path must stay under root; pass relative form to git.
    args.push("--", toWirePath(root, abs) || ".");
  }
  const text = await runGit(root, args);
  if (text === null) return null;
  const max = 512 * 1024;
  const truncated = text.length > max;
  return {
    root,
    ...(opts.path ? { path: opts.path } : {}),
    staged: Boolean(opts.staged),
    text: truncated ? text.slice(0, max) : text,
    truncated,
  };
}

function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let total = 0;
    const cap = 1024 * 1024;
    child.stdout.on("data", (d: Buffer) => {
      if (total >= cap) return;
      const take = d.subarray(0, Math.min(d.length, cap - total));
      chunks.push(take);
      total += take.length;
    });
    child.on("error", () => resolvePromise(null));
    child.on("close", (code) => {
      if (code !== 0 && total === 0) {
        resolvePromise(null);
        return;
      }
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/** Parent relative path for breadcrumb "up" — "" when already at root. */
export function parentRel(rel: string): string {
  const cleaned = sanitizeRel(rel);
  if (cleaned === null || cleaned === "") return "";
  const p = dirname(cleaned);
  return p === "." ? "" : p;
}
