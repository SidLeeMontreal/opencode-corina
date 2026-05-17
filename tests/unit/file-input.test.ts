import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { resolveTextOrFileInput } from "../../src/file-input.js";

describe("file input resolver", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "corina-file-root-"));
    outside = mkdtempSync(join(tmpdir(), "corina-file-outside-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("keeps non-path input as inline text", () => {
    const resolved = resolveTextOrFileInput("This is inline text.", { allowedRoot: root });

    expect(resolved).toMatchObject({
      text: "This is inline text.",
      sourcePath: null,
      sourceType: "text",
    });
  });

  it("reads files inside the allowed root", () => {
    const path = join(root, "draft.txt");
    writeFileSync(path, "Workspace draft");

    const resolved = resolveTextOrFileInput("draft.txt", { allowedRoot: root });

    expect(resolved.text).toBe("Workspace draft");
    expect(resolved.sourcePath).toBe(realpathSync(path));
    expect(resolved.sourceType).toBe("file");
    expect(resolved.note).toBeUndefined();
  });

  it("rejects traversal outside the allowed root", () => {
    const path = join(outside, "secret.txt");
    writeFileSync(path, "do not read");

    const resolved = resolveTextOrFileInput(`../${basename(outside)}/secret.txt`, { allowedRoot: root });

    expect(resolved.text).toBe("");
    expect(resolved.note).toContain("outside allowed workspace root");
  });

  it("rejects absolute paths outside the allowed root", () => {
    const path = join(outside, "secret.txt");
    writeFileSync(path, "do not read");

    const resolved = resolveTextOrFileInput(path, { allowedRoot: root });

    expect(resolved.text).toBe("");
    expect(resolved.note).toContain("outside allowed workspace root");
  });

  it("rejects symlinks that escape the allowed root", () => {
    const outsidePath = join(outside, "secret.txt");
    const linkPath = join(root, "linked-secret.txt");
    writeFileSync(outsidePath, "do not read");
    symlinkSync(outsidePath, linkPath);

    const resolved = resolveTextOrFileInput("linked-secret.txt", { allowedRoot: root });

    expect(resolved.text).toBe("");
    expect(resolved.sourcePath).toBe(realpathSync(outsidePath));
    expect(resolved.note).toContain("outside allowed workspace root");
  });

  it("rejects oversized files", () => {
    const path = join(root, "large.txt");
    writeFileSync(path, "abcdef");

    const resolved = resolveTextOrFileInput("large.txt", { allowedRoot: root, maxBytes: 5 });

    expect(resolved.text).toBe("");
    expect(resolved.note).toContain("larger than 5 bytes");
  });

  it("rejects directories", () => {
    mkdirSync(join(root, "folder"));

    const resolved = resolveTextOrFileInput("folder", { allowedRoot: root });

    expect(resolved.text).toBe("");
    expect(resolved.note).toContain("Rejected directory input");
  });
});
