// Cursor Agent CLI journal adapter.
//
// SHAPE OF THE SOURCE (verified against on-disk logs, 2026-08-27):
//   ~/.cursor/projects/<cwd-slug>/agent-transcripts/<uuid>/<uuid>.jsonl
//   cwd `/home/dano/Documents/obsidian-vault` → slug `home-dano-Documents-obsidian-vault`
//   {"role":"user"|"assistant","message":{"content":[{type:"text"|"tool_use",…}]}}
//   {"type":"turn_ended",…}                                                     ← bookkeeping
//
// Tool RESULTS never appear in these logs — only `tool_use` (name + input). Do not stub an empty
// `result` on the part: the Chat accordion treats any `result` as expandable, and an empty body is
// exactly the "chevron opens, nothing inside" bug.
//
// HOW HERDR NAMES THE SESSION. The cursor integration (herdr-agent-state.sh) *tries* to
// `pane.report_agent_session` on sessionStart, but cursor-agent often never reports an id — live
// panes have `agent:"cursor"` and no `agent_session` at all. Without a ref Collie used to answer
// `no-session` and the Chat tab stayed empty. When Herdr *does* hand a uuid we scan for
// `<uuid>/<uuid>.jsonl` (same uniqueness argument as Claude). When it doesn't, state-engine
// synthesises a lookup ref (`cu:<slug>` or `cu:<slug>:<title>`) from cwd + terminal title so we can
// pick the matching log in that project (title match, else newest mtime).
//
// User turns wrap speech in `<user_query>`; a `<timestamp>` envelope is stripped. Rows have no
// uuid of their own — paging cursors are synthesised like Codex.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { containedRealpath, exists, head, loadTail, rootList, statFile } from "./files.ts";
import {
  clamp,
  MAX_TEXT_CHARS,
  stripAnsi,
  stripRedactedPlaceholders,
  summarizeToolInput,
} from "./text.ts";
import type {
  AgentSessionRef,
  JournalAdapter,
  TranscriptEntry,
  TranscriptPart,
  TranscriptSource,
} from "./types.ts";

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_PREFIX = "cu:";
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const GENERIC_TITLES = new Set(["cursor agent", "cursor", "agent"]);

export function isCursorSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

/** `/home/foo/bar` → `home-foo-bar` — Cursor's project directory name under `~/.cursor/projects`. */
export function cwdToCursorSlug(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "-");
}

export function isCursorSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes("..") && slug.length > 0 && slug.length < 512;
}

/** Strip status suffixes (" - ✅ Ready") so the pane title can match a conversation. */
export function normalizeCursorTitle(title: string): string {
  return title
    .replace(/\s*[-–—]\s*[✅⏳❌✗].*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Synthetic session id used when Herdr reported no uuid. Shape is `cu:<slug>` or `cu:<slug>:<title>`.
 * Slug is charset-validated before any path work; title never touches the filesystem.
 */
export function cursorLookupRef(cwd: string, title: string): string {
  const slug = cwdToCursorSlug(cwd);
  const t = normalizeCursorTitle(title);
  if (!isCursorSlug(slug)) return `cu:_`;
  const generic = GENERIC_TITLES.has(t.toLowerCase());
  return t && !generic ? `${LOOKUP_PREFIX}${slug}:${t}` : `${LOOKUP_PREFIX}${slug}`;
}

export function parseCursorLookup(value: string): { slug: string; title: string } | null {
  if (!value.startsWith(LOOKUP_PREFIX)) return null;
  const rest = value.slice(LOOKUP_PREFIX.length);
  const i = rest.indexOf(":");
  const slug = i === -1 ? rest : rest.slice(0, i);
  const title = i === -1 ? "" : rest.slice(i + 1);
  if (!isCursorSlug(slug) || slug === "_") return null;
  if (title.includes("\0") || title.includes("..") || title.length > 200) return null;
  return { slug, title };
}

/** Speech inside a user turn — Cursor wraps the real prompt in `<user_query>`. */
export function extractCursorUserText(raw: string): string {
  const text = stripAnsi(raw);
  const q = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(text);
  if (q) return (q[1] ?? "").trim();
  return text.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/g, "").trim();
}

/** Stable paging cursor — Cursor rows have no id. Same rationale as journal/codex.ts. */
export function cursorRowCursor(line: string, seen: Map<string, number>): string {
  let hash = 5381;
  for (let i = 0; i < line.length; i++) hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  const key = (hash >>> 0).toString(36);
  const n = seen.get(key) ?? 0;
  seen.set(key, n + 1);
  return n === 0 ? `cu-${key}` : `cu-${key}-${n}`;
}

function isoFromUserText(text: string): string {
  const m = /<timestamp>\s*([^<]+?)\s*<\/timestamp>/.exec(text);
  if (!m) return "";
  const d = new Date(m[1]!.trim());
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b && typeof b === "object" && (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Parse a Cursor agent-transcript jsonl into oldest-first turns. PURE — no fs, no clock.
 */
export function parseCursorTranscript(text: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const seen = new Map<string, number>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: {
      type?: unknown;
      role?: unknown;
      message?: unknown;
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.type === "turn_ended") continue;
    const roleRaw = row.role;
    if (roleRaw !== "user" && roleRaw !== "assistant") continue;
    const message = row.message;
    const content =
      message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;

    const parts: TranscriptPart[] = [];
    let ts = "";
    if (roleRaw === "user") {
      const raw = textBlocks(content);
      const speech = extractCursorUserText(raw);
      ts = isoFromUserText(raw);
      if (speech === "") continue;
      parts.push({ kind: "text", ...clamp(speech, MAX_TEXT_CHARS) });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        const block = b as { type?: unknown; text?: unknown; name?: unknown; input?: unknown };
        if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
          const prose = stripRedactedPlaceholders(stripAnsi(block.text));
          if (prose === "") continue;
          parts.push({ kind: "text", ...clamp(prose, MAX_TEXT_CHARS) });
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          parts.push({
            kind: "tool",
            name: block.name,
            summary: summarizeToolInput(block.input),
          });
        }
      }
    } else {
      const raw = stripRedactedPlaceholders(stripAnsi(textBlocks(content)));
      if (raw !== "") parts.push({ kind: "text", ...clamp(raw, MAX_TEXT_CHARS) });
    }

    if (parts.length === 0) continue;
    entries.push({
      uuid: cursorRowCursor(line, seen),
      ts,
      role: roleRaw,
      parts,
    });
  }
  return entries;
}

async function listJsonl(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const child = join(dir, name);
    const real = await containedRealpath(child, root);
    if (real === null) continue;
    let st;
    try {
      st = await stat(real);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const nested = await listJsonl(real, root);
      out.push(...nested);
    } else if (st.isFile() && name.endsWith(".jsonl")) {
      out.push(real);
    }
  }
  return out;
}

class CursorTranscriptSource implements TranscriptSource {
  private readonly uuidCache = new Map<string, string>();
  private readonly roots: string[];

  constructor(roots: string | readonly string[]) {
    this.roots = rootList(roots);
  }

  async resolve(ref: AgentSessionRef): Promise<string | null> {
    if (ref.kind !== "id") return null;
    if (isCursorSessionId(ref.value)) return this.resolveUuid(ref.value);
    const lookup = parseCursorLookup(ref.value);
    if (lookup === null) return null;
    return this.resolveLookup(lookup.slug, lookup.title);
  }

  private async resolveUuid(sessionId: string): Promise<string | null> {
    const cached = this.uuidCache.get(sessionId);
    if (cached !== undefined) {
      if (await exists(cached)) return cached;
      this.uuidCache.delete(sessionId);
    }
    const file = `${sessionId}.jsonl`;
    for (const root of this.roots) {
      let projects: string[];
      try {
        projects = await readdir(root);
      } catch {
        continue;
      }
      for (const project of projects) {
        const candidate = join(root, project, "agent-transcripts", sessionId, file);
        if (!(await exists(candidate))) continue;
        const real = await containedRealpath(candidate, root);
        if (real === null) break;
        this.uuidCache.set(sessionId, real);
        return real;
      }
    }
    return null;
  }

  private async resolveLookup(slug: string, title: string): Promise<string | null> {
    for (const root of this.roots) {
      const dir = join(root, slug, "agent-transcripts");
      const realDir = await containedRealpath(dir, root);
      if (realDir === null) continue;
      const files = await listJsonl(realDir, root);
      if (files.length === 0) continue;
      if (title === "") return newest(files);
      const needle = title.toLowerCase();
      const scored: { path: string; mtime: number }[] = [];
      for (const path of files) {
        const snippet = (await head(path, 16 * 1024)).toLowerCase();
        if (snippet.includes(needle)) {
          const meta = await statFile(path);
          scored.push({ path, mtime: meta?.mtimeMs ?? 0 });
        }
      }
      if (scored.length > 0) {
        scored.sort((a, b) => b.mtime - a.mtime);
        return scored[0]!.path;
      }
      return newest(files);
    }
    return null;
  }

  stat(path: string) {
    return statFile(path);
  }

  load(path: string) {
    return loadTail(path);
  }
}

async function newest(files: string[]): Promise<string | null> {
  let best: { path: string; mtime: number } | null = null;
  for (const path of files) {
    const meta = await statFile(path);
    if (meta === null) continue;
    if (best === null || meta.mtimeMs > best.mtime) best = { path, mtime: meta.mtimeMs };
  }
  return best?.path ?? null;
}

export function cursorJournal(roots: string | readonly string[]): JournalAdapter {
  return {
    agent: "cursor",
    source: new CursorTranscriptSource(roots),
    parse: parseCursorTranscript,
  };
}
