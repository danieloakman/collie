import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cwdToCursorSlug,
  cursorLookupRef,
  extractCursorUserText,
  isCursorSessionId,
  normalizeCursorTitle,
  parseCursorLookup,
  parseCursorTranscript,
  cursorJournal,
} from "./cursor.ts";

describe("cursor lookup helpers", () => {
  test("cwdToCursorSlug matches Cursor's project directory names", () => {
    expect(cwdToCursorSlug("/home/dano/Documents/obsidian-vault")).toBe(
      "home-dano-Documents-obsidian-vault",
    );
  });

  test("normalizeCursorTitle strips status suffixes", () => {
    expect(normalizeCursorTitle("Effort Date Planner (forked) - ✅ Ready")).toBe(
      "Effort Date Planner (forked)",
    );
  });

  test("cursorLookupRef encodes slug and title", () => {
    const ref = cursorLookupRef(
      "/home/dano/Documents/obsidian-vault",
      "Effort Date Planner (forked) - ✅ Ready",
    );
    expect(parseCursorLookup(ref)).toEqual({
      slug: "home-dano-Documents-obsidian-vault",
      title: "Effort Date Planner (forked)",
    });
  });

  test("generic Cursor Agent title is slug-only", () => {
    expect(parseCursorLookup(cursorLookupRef("/tmp/x", "Cursor Agent"))).toEqual({
      slug: "tmp-x",
      title: "",
    });
  });

  test("rejects traversal in lookup slug", () => {
    expect(parseCursorLookup("cu:../etc")).toBeNull();
    expect(isCursorSessionId("not-a-uuid")).toBe(false);
    expect(isCursorSessionId("bd3a7dd0-cfbf-4b1e-b1c9-18f6ada339d2")).toBe(true);
  });
});

describe("extractCursorUserText", () => {
  test("pulls user_query out of the envelope", () => {
    expect(
      extractCursorUserText(
        "<timestamp>Wed</timestamp>\n<user_query>\nhello there\n</user_query>",
      ),
    ).toBe("hello there");
  });
});

describe("parseCursorTranscript", () => {
  const sample = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          {
            type: "text",
            text: "<timestamp>Wednesday, Aug 26, 2026, 5:52 PM (UTC+10)</timestamp>\n<user_query>\nplan a date\n</user_query>",
          },
        ],
      },
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll look that up." },
          { type: "tool_use", name: "Read", input: { path: "/vault/note.md" } },
        ],
      },
    }),
    JSON.stringify({ type: "turn_ended", status: "success" }),
  ].join("\n");

  test("renders user speech, assistant text, and tool calls; drops turn_ended", () => {
    const entries = parseCursorTranscript(sample);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.role).toBe("user");
    expect(entries[0]!.parts[0]).toMatchObject({ kind: "text", text: "plan a date" });
    expect(entries[1]!.role).toBe("assistant");
    expect(entries[1]!.parts.map((p) => p.kind)).toEqual(["text", "tool"]);
    expect(entries[1]!.parts[1]).toMatchObject({ kind: "tool", name: "Read", summary: "/vault/note.md" });
    // Cursor logs never carry tool output — no empty `result` stub (that made Chat expandable-but-blank).
    expect(entries[1]!.parts[1]).not.toHaveProperty("result");
  });

  test("every turn gets a stable cursor", () => {
    const a = parseCursorTranscript(sample);
    const b = parseCursorTranscript(sample);
    expect(a.map((e) => e.uuid)).toEqual(b.map((e) => e.uuid));
  });
});

describe("CursorTranscriptSource", () => {
  test("resolves a uuid under agent-transcripts and refuses a symlink escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-cursor-"));
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const dir = join(root, "home-x", "agent-transcripts", id);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.jsonl`);
    await writeFile(file, `${JSON.stringify({ role: "user", message: { content: "hi" } })}\n`);

    const adapter = cursorJournal(root);
    expect(await adapter.source.resolve({ kind: "id", value: id })).toBe(file);

    const lookup = cursorLookupRef("/home/x", "anything unused");
    const hit = await adapter.source.resolve({ kind: "id", value: lookup });
    expect(hit).toBe(file);
  });

  test("title match prefers the named conversation over a newer unrelated log", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-cursor-"));
    const slug = "home-vault";
    const base = join(root, slug, "agent-transcripts");
    const oldId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const newId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await mkdir(join(base, oldId), { recursive: true });
    await mkdir(join(base, newId), { recursive: true });
    await writeFile(
      join(base, oldId, `${oldId}.jsonl`),
      `${JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "<user_query>Effort Date Planner (forked)</user_query>" }] },
      })}\n`,
    );
    await writeFile(
      join(base, newId, `${newId}.jsonl`),
      `${JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "<user_query>Gift Finder</user_query>" }] },
      })}\n`,
    );
    const adapter = cursorJournal(root);
    const ref = cursorLookupRef("/home/vault", "Effort Date Planner (forked) - ✅ Ready");
    const path = await adapter.source.resolve({ kind: "id", value: ref });
    expect(path).toBe(join(base, oldId, `${oldId}.jsonl`));
  });
});
