// src/lib/nuruHandoff.ts
//
// How a Nuru connect / sign request reaches the wallet when JollofSwap is NOT
// inside the native Nuru app's browser (which injects window.ethereum):
//
//   • Inside Nuru web (its in-app browser is an iframe; nothing can be
//     injected) → post the nuru:// link to the parent window. Nuru web
//     listens (frame_links_web.dart) and opens the same approve sheet a
//     scanned QR would.
//   • Phone / tablet browser → an "Open in Nuru" button (nuru:// deep link to
//     the installed app). A QR is useless here — you can't scan your own screen.
//   • Desktop → QR code, scanned with the phone.

export type NuruHandoffMode = 'frame' | 'mobile' | 'qr'

export function isInFrame(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top
  } catch {
    return true // cross-origin access to window.top throws → we're framed
  }
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua)) return true
  // iPadOS 13+ reports itself as Mac; it has touch points.
  if (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1) return true
  // Touch-only device with a phone-sized screen.
  try {
    return window.matchMedia('(pointer: coarse) and (hover: none)').matches && window.innerWidth < 900
  } catch {
    return false
  }
}

export function nuruHandoffMode(): NuruHandoffMode {
  if (isInFrame()) return 'frame'
  if (isMobileDevice()) return 'mobile'
  return 'qr'
}

/** Hand a nuru://connect or nuru://sign link to Nuru (see the modes above). */
export function openInNuru(uri: string): void {
  if (isInFrame()) {
    const msg = { type: 'nuru:link', uri }
    try { window.parent.postMessage(msg, '*') } catch { /* ignore */ }
    try { if (window.top && window.top !== window.parent) window.top.postMessage(msg, '*') } catch { /* ignore */ }
    return
  }
  window.location.href = uri
}
