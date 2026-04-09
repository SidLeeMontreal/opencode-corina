import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { PersonalVoiceProfile, ToneFormat, ToneVoice } from "./types.js";

const EMAIL_GREETING = /^(subject:.*\n)?\s*(hi|hello|dear|hey)\b/im;
const EMAIL_SIGNOFF = /\n\s*(best|thanks|thank you|regards|cheers|sincerely),?\s*\n/im;
const HASHTAGS = /(^|\s)#[\p{L}\p{N}_-]+/u;
const TITLE_AND_PARAGRAPHS = /^[^\n]{5,120}\n\n.+/s;
const BULLET_HEAVY = /^(?:[-*•]|\d+\.)\s+/m;
const SHORT_LINE_HEAVY = /^.{1,60}$/gm;
const TECH_TERMS = /(`[^`]+`|\b(api|sdk|json|typescript|javascript|http|endpoint|function|class|method|payload|schema|database|sql|deploy|runtime)\b|\w+\(\))/i;
const UX_TERMS = /\b(click|tap|select|choose|open|menu|button|screen|field|error message|settings|sign in|continue)\b/i;
const SEO_TERMS = /\b(keyword|search intent|meta description|ranking|organic traffic|serp|headline|h1|h2)\b/i;
const ACCESSIBILITY_TERMS = /\b(plain language|screen reader|alt text|accessible|readability|cognitive load|literal|easy to understand)\b/i;
const EXECUTIVE_TERMS = /\b(board|c-suite|executive|budget|roi|tradeoff|decision|risk|portfolio|priority|operating model)\b/i;
const JOURNALISM_TERMS = /\b(according to|reported|report|said|says|source|sources|study|studies|survey|announced|published)\b/i;

function shortLineCount(text: string): number {
  const matches = text.match(SHORT_LINE_HEAVY);
  return matches?.length ?? 0;
}

export function inferFormat(text: string): ToneFormat {
  const normalized = text.trim();
  if (!normalized) {
    return "other";
  }

  if (EMAIL_GREETING.test(normalized) && EMAIL_SIGNOFF.test(normalized)) {
    return "email";
  }

  if (BULLET_HEAVY.test(normalized) && normalized.split(/\n{2,}/).length <= 6) {
    return "slide";
  }

  if (HASHTAGS.test(normalized) || shortLineCount(normalized) >= 3) {
    return "social";
  }

  if (/\b(summary|bottom line|recommendation|decision|memo)\b/i.test(normalized) && normalized.length > 250) {
    return "brief";
  }

  if (TITLE_AND_PARAGRAPHS.test(normalized) || normalized.length > 180) {
    return "article";
  }

  return "article";
}

export function inferVoice(text: string): ToneVoice {
  const normalized = text.trim();

  if (!normalized) {
    return "persuasive";
  }

  if (EMAIL_GREETING.test(normalized) && EMAIL_SIGNOFF.test(normalized)) {
    return "email";
  }

  if (TECH_TERMS.test(normalized)) {
    return "technical";
  }

  if (HASHTAGS.test(normalized) || shortLineCount(normalized) >= 4) {
    return "social";
  }

  if (UX_TERMS.test(normalized)) {
    return "ux";
  }

  if (SEO_TERMS.test(normalized)) {
    return "seo";
  }

  if (ACCESSIBILITY_TERMS.test(normalized)) {
    return "accessibility";
  }

  if (EXECUTIVE_TERMS.test(normalized)) {
    return "executive";
  }

  if (JOURNALISM_TERMS.test(normalized)) {
    return "journalist";
  }

  return "persuasive";
}

export function resolveVoiceProfile(voice: string, profilesDir: string): object | null {
  if (voice !== "brand") {
    return null;
  }

  try {
    const files = readdirSync(profilesDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => ({
        entry,
        path: join(profilesDir, entry),
        mtimeMs: statSync(join(profilesDir, entry)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.entry.localeCompare(b.entry));

    const first = files[0];
    if (!first) {
      return null;
    }

    return JSON.parse(readFileSync(first.path, "utf8")) as object;
  } catch {
    return null;
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildPersonalVoiceProfile(toneDesc: string): PersonalVoiceProfile {
  const lower = toneDesc.toLowerCase();

  const sentence_length = /\bshort\b/.test(lower)
    ? "short"
    : /\bvaried\b|short to medium|short-to-medium|mix of short/.test(lower)
      ? "varied"
      : /\blong\b/.test(lower)
        ? "long"
        : "unspecified";

  const mentionsCasual = /\bcasual\b|conversational|friendly/.test(lower);
  const mentionsProfessional = /\bprofessional\b|executive|businesslike/.test(lower);
  const mentionsTechnical = /\btechnical\b|engineering|developer|api|schema/.test(lower);

  const vocabulary_register = mentionsCasual && mentionsProfessional
    ? "mixed"
    : mentionsTechnical
      ? "technical"
      : mentionsProfessional
        ? "professional"
        : mentionsCasual
          ? "casual"
          : "unspecified";

  const markerMap = [
    "humorous",
    "self-aware",
    "formal",
    "skeptical",
    "warm",
    "sharp",
    "friendly",
    "direct",
    "dry humor",
    "blunt",
    "playful",
    "confident",
  ];

  const personality_markers = uniq(
    markerMap.filter((marker) => lower.includes(marker)).map((marker) => (marker === "dry humor" ? "humorous" : marker)),
  );

  const avoidMatches = [
    ...lower.matchAll(/\bno\s+([a-z][a-z\s-]{1,30})/g),
    ...lower.matchAll(/\bavoid\s+([a-z][a-z\s-]{1,30})/g),
  ].map((match) => match[1].trim().replace(/[.,;:!?]+$/, ""));

  const explicit_style_rules = uniq(
    toneDesc
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter(
        (line) =>
          /^(use|avoid|keep|prefer|write|sound|be|do not|don't)\b/i.test(line) ||
          /\b(sentences?|paragraphs?|jargon|hype|hedging|humor|em dashes?)\b/i.test(line),
      ),
  );

  return {
    sentence_length,
    vocabulary_register,
    personality_markers,
    avoid: uniq(avoidMatches),
    explicit_style_rules,
  };
}

export function inferToneDefaults(input: { text: string; voice?: string; format?: string }): {
  format: ToneFormat;
  voice: ToneVoice;
} {
  return {
    format: (input.format?.trim() as ToneFormat | undefined) || inferFormat(input.text),
    voice: (input.voice?.trim() as ToneVoice | undefined) || inferVoice(input.text),
  };
}
