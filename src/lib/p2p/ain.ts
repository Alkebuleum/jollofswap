// src/lib/p2p/ain.ts
//
// AIN ⇄ bytes32, matching Nuru's lib/utils/ain_utils.dart: an AIN like
// "VI05227152" is ASCII-encoded and right-padded with zeros to 32 bytes.

const AIN_RE = /^([A-Za-z]{2})(\d{1,8})$/

/** Canonical AA######## (letters upper-cased, digits zero-padded) or null. */
export function canonicalAin(input: string | null | undefined): string | null {
  const m = AIN_RE.exec((input ?? '').trim())
  if (!m) return null
  return m[1].toUpperCase() + m[2].padStart(8, '0')
}

export function ainToBytes32(ain: string): string {
  const canon = canonicalAin(ain)
  if (!canon) throw new Error(`Not an AIN: ${ain}`)
  let hex = '0x'
  for (const ch of canon) hex += ch.charCodeAt(0).toString(16).padStart(2, '0')
  return hex.padEnd(66, '0')
}

/** Decodes a bytes32 holding an ASCII AIN; null when it doesn't hold one. */
export function bytes32ToAin(hex: string | null | undefined): string | null {
  const h = (hex ?? '').replace(/^0x/, '')
  if (!h || /^0*$/.test(h)) return null
  let ascii = ''
  for (let i = 0; i + 1 < h.length; i += 2) {
    const code = parseInt(h.slice(i, i + 2), 16)
    if (code === 0) break
    ascii += String.fromCharCode(code)
  }
  const exact = canonicalAin(ascii)
  if (exact) return exact
  const any = /([A-Za-z]{2})(\d{1,8})/.exec(ascii)
  return any ? canonicalAin(any[1] + any[2]) : null
}
