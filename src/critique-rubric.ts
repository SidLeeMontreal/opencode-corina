import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { ResolvedRubric, RubricDimension } from "./types.js";

const BUILTIN_RUBRIC_DIR = join(homedir(), ".config", "opencode", "corina", "rubrics");
const DEFAULT_RUBRIC_ID = "corina";

interface ParsedDimension {
  id?: string;
  name?: string;
  label?: string;
  max_score?: number;
  description?: string;
  guidance?: string;
}

interface ParsedFrontmatter {
  id?: string;
  name?: string;
  version?: string | number;
  voice_profile_hint?: string;
  dimensions?: ParsedDimension[];
}

function parseSimpleValue(value: string): string | number {
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(markdown: string): { frontmatter: ParsedFrontmatter; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Rubric file is missing YAML frontmatter.");
  }

  const [, rawFrontmatter, body] = match;
  const lines = rawFrontmatter.split(/\r?\n/);
  const frontmatter: ParsedFrontmatter = {};
  let currentListKey: keyof ParsedFrontmatter | null = null;
  let currentItem: Record<string, unknown> | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    if (/^[A-Za-z0-9_]+:\s*$/.test(line)) {
      const key = line.split(":")[0] as keyof ParsedFrontmatter;
      currentListKey = key;
      if (key === "dimensions") {
        frontmatter.dimensions = [];
      }
      currentItem = null;
      continue;
    }

    const topLevel = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (topLevel && !line.startsWith("  ")) {
      const [, key, rawValue] = topLevel;
      frontmatter[key as keyof ParsedFrontmatter] = parseSimpleValue(rawValue) as never;
      currentListKey = null;
      currentItem = null;
      continue;
    }

    const itemStart = line.match(/^\s*-\s+([A-Za-z0-9_]+):\s*(.+)$/);
    if (itemStart && currentListKey === "dimensions") {
      currentItem = {
        [itemStart[1]]: parseSimpleValue(itemStart[2]),
      };
      frontmatter.dimensions?.push(currentItem as ParsedDimension);
      continue;
    }

    const nested = line.match(/^\s+([A-Za-z0-9_]+):\s*(.+)$/);
    if (nested && currentItem) {
      currentItem[nested[1]] = parseSimpleValue(nested[2]);
    }
  }

  return { frontmatter, body: body.trim() };
}

function normalizeDimensionId(id: string): string {
  return id === "corina_tone" ? "tone" : id;
}

function toDimension(input: ParsedDimension | undefined, index: number): RubricDimension {
  const id = normalizeDimensionId(String(input?.id ?? `dimension_${index + 1}`));
  const name = String(input?.name ?? input?.label ?? id);
  const maxScore = Number(input?.max_score ?? 5);
  const description = String(input?.description ?? input?.guidance ?? "").trim();

  return {
    id,
    name,
    max_score: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 5,
    description,
  };
}

export function getRubricSearchPaths(): string[] {
  return [BUILTIN_RUBRIC_DIR];
}

function resolveRubricPath(nameOrPath: string): string | null {
  const trimmed = nameOrPath.trim();
  if (!trimmed) return null;

  const explicitCandidates = [trimmed, resolve(trimmed)];
  for (const candidate of explicitCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  for (const dir of getRubricSearchPaths()) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseRubricFile(filePath: string): ResolvedRubric {
  const raw = readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const dimensions = Array.isArray(frontmatter.dimensions)
    ? frontmatter.dimensions.map((dimension, index) => toDimension(dimension, index))
    : [];

  if (!frontmatter.id || !frontmatter.name || !frontmatter.version || !dimensions.length) {
    throw new Error(`Invalid rubric frontmatter in ${basename(filePath)}.`);
  }

  return {
    id: String(frontmatter.id),
    name: String(frontmatter.name),
    version: String(frontmatter.version),
    dimensions,
    raw_markdown: body,
    source_path: filePath,
  };
}

export function loadRubric(nameOrPath: string): ResolvedRubric {
  const requested = nameOrPath?.trim() || DEFAULT_RUBRIC_ID;
  const resolvedPath = resolveRubricPath(requested);

  if (resolvedPath) {
    try {
      return parseRubricFile(resolvedPath);
    } catch {
      // Fall through to default rubric.
    }
  }

  const fallbackPath = resolveRubricPath(DEFAULT_RUBRIC_ID);
  if (!fallbackPath) {
    throw new Error(`Could not resolve fallback rubric '${DEFAULT_RUBRIC_ID}'.`);
  }

  return parseRubricFile(fallbackPath);
}
