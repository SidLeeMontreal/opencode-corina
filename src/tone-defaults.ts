export type InferredFormat = "article" | "email" | "social"
export type InferredVoice = "technical" | "persuasive"

export interface ToneDefaultsInput {
  text: string
  voice?: string
  format?: string
}

const EMAIL_GREETING = /^(hi|hello|dear|hey)\b/im
const EMAIL_SIGNOFF = /(best|thanks|thank you|regards|cheers|sincerely),?\s*[\s\S]*$/im
const HASHTAGS = /(^|\s)#[\p{L}\p{N}_-]+/u
const TITLE_AND_PARAGRAPHS = /^[^\n]{5,120}\n\n.+/s
const TECH_TERMS = /(`[^`]+`|\b(api|sdk|json|typescript|javascript|http|endpoint|function|class|method|payload|schema)\b|\w+\(\))/i
const TECH_ACRONYMS = /\b[A-Z_]{2,}\b/

export function inferFormat(text: string): InferredFormat {
  const normalized = text.trim()

  if (EMAIL_GREETING.test(normalized) && EMAIL_SIGNOFF.test(normalized)) {
    return "email"
  }

  if (HASHTAGS.test(normalized)) {
    return "social"
  }

  if (TITLE_AND_PARAGRAPHS.test(normalized)) {
    return "article"
  }

  return "article"
}

export function inferVoice(text: string, providedVoice?: string): string {
  if (providedVoice?.trim()) {
    return providedVoice.trim()
  }

  if (TECH_TERMS.test(text) || TECH_ACRONYMS.test(text)) {
    return "technical"
  }

  return "persuasive"
}

export function inferToneDefaults(input: ToneDefaultsInput): { format: string; voice: string } {
  return {
    format: input.format?.trim() || inferFormat(input.text),
    voice: inferVoice(input.text, input.voice),
  }
}
