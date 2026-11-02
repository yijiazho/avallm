// Text hardening shared by every prompt surface that embeds player-authored
// speech. It lives here, with the other domain-free primitives, because both
// the live decision prompts and the post-game review need the same boundary
// without importing each other.
//
// Strip markup that could pose as system or format directives before human or
// bot text enters any prompt (sanitize-at-boundary). The order matters: the
// directive-shaped tags go first, then ordinary tags, then whitespace collapse,
// then the length cap. This is a move of the function that used to live in
// server/agents/raw-llm/prompts.ts, so callers keep byte-identical output.
export function sanitizeSpeech(text: string): string {
  return text
    .replace(/\[\/?INST\]|<<\/?SYS>>|<\|[^|]*\|>/gi, ' ')
    .replace(/<\/?[a-z_|/\\-]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}
