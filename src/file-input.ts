import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_MAX_BYTES = 1024 * 1024;

export interface ResolvedTextOrFileInput {
  text: string;
  sourcePath: string | null;
  sourceType: "text" | "file";
  note?: string;
}

export interface ResolveTextOrFileInputOptions {
  allowedRoot?: string;
  maxBytes?: number;
}

function configuredMaxBytes(): number {
  const parsed = Number(process.env["CORINA_FILE_INPUT_MAX_BYTES"]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function configuredRoot(): string {
  return process.env["CORINA_FILE_INPUT_ROOT"]?.trim() || process.cwd();
}

function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."));
}

function candidatePaths(trimmed: string, allowedRoot: string): string[] {
  const paths = isAbsolute(trimmed) ? [trimmed] : [resolve(allowedRoot, trimmed), resolve(trimmed)];
  return [...new Set(paths)];
}

export function resolveTextOrFileInput(
  textOrPath: string,
  options: ResolveTextOrFileInputOptions = {},
): ResolvedTextOrFileInput {
  const trimmed = textOrPath.trim();
  if (!trimmed) {
    return { text: "", sourcePath: null, sourceType: "text" };
  }

  const allowedRoot = realpathSync(options.allowedRoot ?? configuredRoot());
  const maxBytes = options.maxBytes ?? configuredMaxBytes();

  for (const candidate of candidatePaths(trimmed, allowedRoot)) {
    if (!existsSync(candidate)) continue;

    let realPath: string;
    try {
      realPath = realpathSync(candidate);
    } catch {
      return { text: "", sourcePath: candidate, sourceType: "file", note: `Could not resolve file path at ${candidate}.` };
    }

    if (!isInsideRoot(realPath, allowedRoot)) {
      return {
        text: "",
        sourcePath: realPath,
        sourceType: "file",
        note: `Rejected file path outside allowed workspace root: ${realPath}.`,
      };
    }

    const stats = statSync(realPath);
    if (stats.isDirectory()) {
      return { text: "", sourcePath: realPath, sourceType: "file", note: `Rejected directory input: ${realPath}.` };
    }

    if (stats.size > maxBytes) {
      return {
        text: "",
        sourcePath: realPath,
        sourceType: "file",
        note: `Rejected file larger than ${maxBytes} bytes: ${realPath}.`,
      };
    }

    try {
      return { text: readFileSync(realPath, "utf8"), sourcePath: realPath, sourceType: "file" };
    } catch {
      return { text: "", sourcePath: realPath, sourceType: "file", note: `Could not read file at ${realPath}.` };
    }
  }

  return { text: trimmed, sourcePath: null, sourceType: "text" };
}
