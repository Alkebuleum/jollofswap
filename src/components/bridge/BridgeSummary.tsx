import { useState } from 'react'
import { NETWORK_LABEL } from './BridgeDirectionSelector'
import { formatAlkeAmountCommas } from '../../lib/bridge/amount'
import { ALKE_BRIDGE_MIN_RAW, ALKE_BRIDGE_MAX_PER_TX_RAW, ALKE_BRIDGE_DAILY_LIMIT_RAW } from '../../lib/bridge/config'

export default function BridgeSummary({
  sourceNetwork,
  destinationNetwork,
  destinationAmountDisplay,
  requiredGasAsset,
}: {
  sourceNetwork: 'alkebuleum' | 'bsc'
  destinationNetwork: 'alkebuleum' | 'bsc'
  destinationAmountDisplay: string
  requiredGasAsset: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px', fontFamily: 'DM Mono', fontSize: 13, color: 'var(--muted)' }}>
        1 ALKE = 1 ALKE
      </div>

      <div className="jlf-details">
        <div className="jlf-det-row" onClick={() => setOpen((v) => !v)}>
          <span className="l">Bridge details</span>
          <span className="r"><span className="ex">{open ? '▲' : '▼'}</span></span>
        </div>
        <div className={`jlf-det-body${open ? ' open' : ''}`}>
          <div className="jlf-det-line"><span className="k">Source network</span><span>{NETWORK_LABEL[sourceNetwork]}</span></div>
          <div className="jlf-det-line"><span className="k">Destination network</span><span>{NETWORK_LABEL[destinationNetwork]}</span></div>
          <div className="jlf-det-line"><span className="k">You receive</span><span>{destinationAmountDisplay} ALKE</span></div>
          <div className="jlf-det-line"><span className="k">Required gas</span><span>{requiredGasAsset}</span></div>
          <div className="jlf-det-line"><span className="k">Minimum</span><span>{formatAlkeAmountCommas(ALKE_BRIDGE_MIN_RAW)} ALKE</span></div>
          <div className="jlf-det-line"><span className="k">Maximum per transaction</span><span>{formatAlkeAmountCommas(ALKE_BRIDGE_MAX_PER_TX_RAW)} ALKE</span></div>
          <div className="jlf-det-line"><span className="k">Daily bridge limit</span><span>{formatAlkeAmountCommas(ALKE_BRIDGE_DAILY_LIMIT_RAW)} ALKE</span></div>
        </div>
      </div>
    </>
  )
}
