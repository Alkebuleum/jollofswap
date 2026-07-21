import { isOperatorAttention, isTerminalSuccess } from '../../lib/bridge/api'

export default function BridgeStatusBadge({ state }: { state: string }) {
  const success = isTerminalSuccess(state)
  const attention = isOperatorAttention(state)

  const color = success ? 'var(--green)' : attention ? 'var(--red)' : 'var(--gold, #E3A92E)'
  const bg = success ? 'var(--green-d)' : attention ? 'rgba(255,90,60,.14)' : 'rgba(227,169,46,.14)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 100,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {state}
    </span>
  )
}
