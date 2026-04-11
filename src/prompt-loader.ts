import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROMPTS_DIR = join(__dirname, "..", "prompts");
export const LOCAL_OVERRIDE_DIR = join(process.cwd(), ".corina-local", "prompts");

const promptCache = new Map<string, string>();

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\n---\r?\n?/, "").trim();
}

/** Voice id (e.g. ToneVoice) → bundled path under `prompts/`. Default is `voices/${voice}.md`. */
const VOICE_PROMPT_RELATIVE_PATH: Partial<Record<string, string>> = {
  email: "voices/commercial-email.md",
};

export function voicePromptRelativePath(voice: string): string {
  return VOICE_PROMPT_RELATIVE_PATH[voice] ?? `voices/${voice}.md`;
}

export function promptExists(relativePath: string): boolean {
  return existsSync(join(LOCAL_OVERRIDE_DIR, relativePath)) || existsSync(join(PROMPTS_DIR, relativePath));
}

export function loadPrompt(relativePath: string): string {
  const cached = promptCache.get(relativePath);
  if (cached) {
    return cached;
  }

  const overridePath = join(LOCAL_OVERRIDE_DIR, relativePath);
  const bundledPath = join(PROMPTS_DIR, relativePath);
  const resolvedPath = existsSync(overridePath) ? overridePath : bundledPath;
  const content = stripFrontmatter(readFileSync(resolvedPath, "utf8"));
  promptCache.set(relativePath, content);
  return content;
}
