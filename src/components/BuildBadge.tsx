// src/components/BuildBadge.tsx
//
// Build fingerprint so a stale cached/deployed bundle is obvious at a
// glance instead of silently showing old behavior. Commit hash + build
// time are baked in by vite.config.ts's `define`.
//
// Exposed two ways: a fixed corner tag for normal desktop/mobile web, and
// buildLabel()/BUILD_INFO for embedding inline (e.g. in TopBar's mobile
// nav drawer) — `position: fixed` overlays are unreliable inside some
// in-app/embedded browsers (e.g. Nuru), so anything that must be visible
// there needs to render in normal document flow instead.

export const BUILD_INFO = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { commit: 'dev', builtAt: '' }

export function buildTimeLabel() {
  return BUILD_INFO.builtAt
    ? new Date(BUILD_INFO.builtAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'local dev'
}

export default function BuildBadge() {
  return (
    <div
      title={`Build ${BUILD_INFO.commit} · ${BUILD_INFO.builtAt || 'local dev'}`}
      style={{
        position: 'fixed',
        bottom: 6,
        right: 8,
        zIndex: 40,
        fontSize: 10.5,
        fontFamily: 'DM Mono, monospace',
        color: 'var(--muted)',
        opacity: 0.45,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {BUILD_INFO.commit} · {buildTimeLabel()}
    </div>
  )
}
