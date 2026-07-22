// src/components/BuildBadge.tsx
//
// Tiny build fingerprint pinned to a corner so a stale cached/deployed
// bundle is obvious at a glance instead of silently showing old behavior.
// Commit hash + build time are baked in by vite.config.ts's `define`.

const BUILD_INFO = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { commit: 'dev', builtAt: '' }

export default function BuildBadge() {
  const timeLabel = BUILD_INFO.builtAt
    ? new Date(BUILD_INFO.builtAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'local dev'

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
      {BUILD_INFO.commit} · {timeLabel}
    </div>
  )
}
