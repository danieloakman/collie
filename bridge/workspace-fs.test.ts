import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listTree,
  readWorkspaceFile,
  sanitizeRel,
  resolveUnderRoot,
  workspaceRootForCwd,
} from "./workspace-fs.ts";

describe("sanitizeRel", () => {
  test("empty and dot are the root", () => {
    expect(sanitizeRel("")).toBe("");
    expect(sanitizeRel(".")).toBe("");
    expect(sanitizeRel(null)).toBe("");
  });
  test("rejects absolute and parent traversal", () => {
    expect(sanitizeRel("/etc/passwd")).toBeNull();
    expect(sanitizeRel("foo/../bar")).toBeNull();
    expect(sanitizeRel("..")).toBeNull();
    expect(sanitizeRel("C:\\Windows")).toBeNull();
  });
  test("accepts nested relative", () => {
    expect(sanitizeRel("src/lib/a.ts")).toBe(join("src", "lib", "a.ts"));
  });
});

describe("workspace fs containment", () => {
  test("cannot escape via .. or symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-fs-"));
    await mkdir(join(root, "in"));
    await writeFile(join(root, "in", "ok.txt"), "hello");
    await writeFile(join(root, "secret.txt"), "nope");
    await symlink(join(root, "secret.txt"), join(root, "in", "escape"));

    expect(await resolveUnderRoot(root, "in/../secret.txt")).toBeNull();
    // Symlink target still inside root is allowed by containedRealpath; escape outside:
    const outside = await mkdtemp(join(tmpdir(), "collie-out-"));
    await writeFile(join(outside, "x"), "x");
    await symlink(join(outside, "x"), join(root, "in", "outlink"));
    expect(await resolveUnderRoot(root, "in/outlink")).toBeNull();

    const tree = await listTree(root, "in");
    expect(tree?.entries.some((e) => e.name === "ok.txt")).toBe(true);

    const file = await readWorkspaceFile(root, "in/ok.txt");
    expect(file?.text).toBe("hello");
    expect(await readWorkspaceFile(root, "in/outlink")).toBeNull();
  });

  test("workspaceRootForCwd returns cwd when not a git repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-cwd-"));
    const resolved = await workspaceRootForCwd(root);
    expect(resolved).toBeTruthy();
  });
});
