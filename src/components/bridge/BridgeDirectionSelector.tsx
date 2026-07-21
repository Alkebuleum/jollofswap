import type { BridgeDirection } from '../../lib/bridge/config'

const NETWORK_LABEL: Record<'alkebuleum' | 'bsc', string> = {
  alkebuleum: 'Alkebuleum',
  bsc: 'BNB Chain',
}

export function sourceNetwork(direction: BridgeDirection): 'alkebuleum' | 'bsc' {
  return direction === 'lock-to-mint' ? 'alkebuleum' : 'bsc'
}

export function destinationNetwork(direction: BridgeDirection): 'alkebuleum' | 'bsc' {
  return direction === 'lock-to-mint' ? 'bsc' : 'alkebuleum'
}

export default function BridgeDirectionSelector({
  direction,
  onFlip,
  disabled,
}: {
  direction: BridgeDirection
  onFlip: () => void
  disabled?: boolean
}) {
  return (
    <div className="jlf-flip">
      <button type="button" onClick={onFlip} disabled={disabled} aria-label="Switch bridge direction" title="Switch direction">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <path d="M7 10l5-5 5 5M7 14l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

export { NETWORK_LABEL }
