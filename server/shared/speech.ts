// Text hardening shared by every prompt surface that embeds player-authored
// speech. It lives here, with the other domain-free primitives, because both
// the live decision prompts and the post-game review need the same boundary
// without importing each other.
//
// Strip markup that could pose as system or format directives before human or
// bot text enters any prompt (sanitize-at-boundary). The order matters: the
// directive-shaped tags go first, then ordinary tags, then whitespace collapse.
// `sanitizeSpeech` keeps the historical 400-character cap for ordinary prompt
// surfaces. `sanitizeSpeechText` is the same hardening without the cap, used
// only for the post-game human talk where the player controls the length.
export function sanitizeSpeechText(text: string): string {
  return text
    .replace(/\[\/?INST\]|<<\/?SYS>>|<\|[^|]*\|>/gi, ' ')
    .replace(/<\/?[a-z_|/\\-]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sanitizeSpeech(text: string): string {
  return sanitizeSpeechText(text).slice(0, 400)
}
