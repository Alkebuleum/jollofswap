// src/lib/staleBuild.ts
//
// Detects a tab/webview still running an older deployed bundle. The app is
// an SPA, so a tab (or an in-app browser like Nuru that keeps its webview
// alive) opened before a deploy keeps executing the old JS indefinitely.
// That's how a pre-Sep-29 client kept polling GET /deposits/:hash and never
// called POST /v1/bridge/deposit-tx even though the new build was live.
//
// We compare the entry chunk this page loaded against the one the live
// index.html currently references (Vite content-hashes it per build).

function loadedEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  const m = el?.src.match(/\/assets\/index-[\w-]+\.js/)
  return m ? m[0] : null
}

// true = a newer build is live; false = current or couldn't tell (dev
// server, offline) — never blocks the user on a failed check.
export async function isStaleBuild(): Promise<boolean> {
  const mine = loadedEntry()
  if (!mine) return false
  try {
    const html = await fetch(`/index.html?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.text() : '')
    const live = html.match(/\/assets\/index-[\w-]+\.js/)?.[0]
    return !!live && live !== mine
  } catch {
    return false
  }
}
