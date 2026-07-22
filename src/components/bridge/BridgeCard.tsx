// src/components/bridge/BridgeCard.tsx
//
// Orchestrates the bridge form: direction, amount, destination address,
// safety checks, and submission. Composition only — the actual logic lives
// in src/hooks/bridge/* and src/lib/bridge/* (ALKEBRIDGE.md §16: "Do not
// place all bridge behavior in one page component").

import { useEffect, useMemo, useState } from 'react'
import { useConnectModalStore } from '../../store/connectModalStore'
import { useWalletConnection } from '../../hooks/useWalletConnection'
import { useBridgeAccess } from '../../hooks/bridge/useBridgeAccess'
import { useBridgeSignerAddress } from '../../hooks/bridge/useBridgeSignerAddress'
import { useBridgeBalances } from '../../hooks/bridge/useBridgeBalances'
import { useBridgeContractState, isBridgePaused } from '../../hooks/bridge/useBridgeContractState'
import { useBridgeTransaction } from '../../hooks/bridge/useBridgeTransaction'
import { useBridgeStatus } from '../../hooks/bridge/useBridgeStatus'
import { useAlkeBurnRegistration } from '../../hooks/bridge/useAlkeBurnRegistration'
import { readActiveBridgeTx, clearActiveBridgeTx } from '../../lib/bridge/persistence'
import { parseAlkeAmount, formatAlkeAmount, formatAlkeAmountCommas, validateAmount, AMOUNT_VALIDATION_MESSAGES } from '../../lib/bridge/amount'
import type { BridgeDirection } from '../../lib/bridge/config'
import { isOperatorAttention, isTerminalSuccess } from '../../lib/bridge/api'
import BridgeAmountInput from './BridgeAmountInput'
import BridgeNetworkPanel from './BridgeNetworkPanel'
import BridgeDirectionSelector, { sourceNetwork, destinationNetwork } from './BridgeDirectionSelector'
import BridgeSummary from './BridgeSummary'
import BridgeProgress from './BridgeProgress'
import { ethers } from 'ethers'

export default function BridgeCard({ onCompleted }: { onCompleted?: () => void }) {
  const { isConnected } = useWalletConnection()
  const address = useBridgeSignerAddress() // EOA — the address that actually bridges
  const { openModal } = useConnectModalStore()
  const access = useBridgeAccess()
  const balances = useBridgeBalances()
  const contractState = useBridgeContractState()
  const { phase: submitPhase, error: submitError, sourceTransactionHash: freshTxHash, submit, reset } = useBridgeTransaction()

  const [direction, setDirection] = useState<BridgeDirection>('lock-to-mint')
  const [amount, setAmount] = useState('')
  const [useAdvancedDest, setUseAdvancedDest] = useState(false)
  const [advancedDest, setAdvancedDest] = useState('')
  const [burnWarningAcked, setBurnWarningAcked] = useState(false)
  const [restoredTxHash, setRestoredTxHash] = useState<string | null>(null)
  const [restoredDirection, setRestoredDirection] = useState<BridgeDirection | null>(null)

  // Restore an in-flight transaction on mount (ALKEBRIDGE.md §12).
  useEffect(() => {
    const stored = readActiveBridgeTx()
    if (stored) {
      setRestoredTxHash(stored.sourceTransactionHash)
      setRestoredDirection(stored.direction)
    }
  }, [])

  const activeTxHash = restoredTxHash ?? freshTxHash
  const activeDirection = restoredTxHash ? (restoredDirection ?? direction) : direction
  const status = useBridgeStatus(activeTxHash)
  const burnRegistration = useAlkeBurnRegistration(activeDirection, activeTxHash)

  useEffect(() => {
    if (status.transaction && isTerminalSuccess(status.transaction.state)) {
      clearActiveBridgeTx()
      onCompleted?.()
    }
  }, [status.transaction, onCompleted])

  function dismissProgress() {
    if ((status.transaction && isOperatorAttention(status.transaction.state)) || burnRegistration.status === 'fatal') {
      clearActiveBridgeTx()
    }
    setRestoredTxHash(null)
    setRestoredDirection(null)
    reset()
  }

  function flipDirection() {
    setDirection((d) => (d === 'lock-to-mint' ? 'burn-to-release' : 'lock-to-mint'))
    setAmount('')
    setUseAdvancedDest(false)
    setAdvancedDest('')
    setBurnWarningAcked(false)
    reset()
  }

  const amountRaw = useMemo(() => parseAlkeAmount(amount), [amount])
  const sourceBalanceRaw = direction === 'lock-to-mint' ? balances.nativeAlkeRaw : balances.bnbAlkeRaw
  const destinationBalanceRaw = direction === 'lock-to-mint' ? balances.bnbAlkeRaw : balances.nativeAlkeRaw
  const destination = advancedDest && useAdvancedDest ? advancedDest : address ?? ''

  const paused = isBridgePaused(contractState)
  const vault = contractState.vault
  const bnbToken = contractState.bnbToken

  const amountError =
    amountRaw != null
      ? validateAmount(amountRaw, { balanceRaw: sourceBalanceRaw ?? undefined })
      : null

  let capacityError: string | null = null
  if (amountRaw != null) {
    if (direction === 'lock-to-mint' && vault && amountRaw > vault.remainingCapacityRaw) {
      capacityError = "This amount exceeds the bridge's remaining capacity."
    }
    if (direction === 'burn-to-release' && vault && amountRaw > vault.totalLockedRaw) {
      capacityError = 'This amount exceeds the currently locked native ALKE backing.'
    }
  }

  const destInvalid = useAdvancedDest && advancedDest !== '' && !ethers.isAddress(advancedDest)

  let disabledReason: string | null = null
  if (!isConnected) disabledReason = null // handled by "Connect wallet" button state below
  else if (access.disabledReason) disabledReason = access.disabledReason
  else if (contractState.loading) disabledReason = 'Checking bridge status…'
  else if (contractState.error) disabledReason = 'ALKE bridge operations are temporarily paused.'
  else if (paused) disabledReason = 'ALKE bridge operations are temporarily paused.'
  else if (!vault?.bytecodeExists || !bnbToken?.bytecodeExists) disabledReason = 'ALKE bridge operations are temporarily paused.'
  else if (!amountRaw) disabledReason = null
  else if (amountError) disabledReason = AMOUNT_VALIDATION_MESSAGES[amountError]
  else if (capacityError) disabledReason = capacityError
  else if (destInvalid) disabledReason = 'Destination address is not a valid EVM address.'
  else if (direction === 'burn-to-release' && (balances.bnbGasRaw ?? 0n) === 0n) disabledReason = 'Insufficient BNB for transaction gas.'
  else if (direction === 'burn-to-release' && !burnWarningAcked) disabledReason = 'Confirm the burn warning below to continue.'

  const canSubmit = isConnected && !disabledReason && amountRaw != null && amountRaw > 0n

  async function handleSubmit() {
    if (!isConnected) {
      openModal()
      return
    }
    if (!canSubmit || amountRaw == null) return
    await submit(direction, amountRaw, destination)
    setAmount('')
  }

  const showProgress = submitPhase !== 'idle' || activeTxHash != null

  return (
    <div className="jlf-swap-card jlf-swap-col">
      <div className="jlf-swap-top">
        <div className="jlf-stabs">
          <button className="active">Bridge ALKE</button>
        </div>
      </div>

      <BridgeAmountInput
        network={sourceNetwork(direction)}
        value={amount}
        onChange={setAmount}
        balanceRaw={sourceBalanceRaw}
        onMax={() => sourceBalanceRaw != null && setAmount(formatAlkeAmount(sourceBalanceRaw))}
        disabled={!access.isAuthorized}
      />

      <BridgeDirectionSelector direction={direction} onFlip={flipDirection} />

      <BridgeNetworkPanel
        role="To"
        network={destinationNetwork(direction)}
        amountDisplay={amount || '0'}
        balanceDisplay={destinationBalanceRaw != null ? formatAlkeAmountCommas(destinationBalanceRaw) : undefined}
        readOnly
      />

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setUseAdvancedDest((v) => !v)}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}
        >
          {useAdvancedDest ? 'Use connected wallet address' : 'Use a different receiving address'}
        </button>
        {useAdvancedDest && (
          <input
            className="jlf-amt"
            style={{ fontSize: 14, marginTop: 8, fontFamily: 'DM Mono' }}
            value={advancedDest}
            onChange={(e) => setAdvancedDest(e.target.value)}
            placeholder="0x…"
          />
        )}
      </div>

      {direction === 'burn-to-release' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>
          <input type="checkbox" checked={burnWarningAcked} onChange={(e) => setBurnWarningAcked(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Your ALKE on BNB Chain will be permanently burned. An equal amount of native ALKE will be released on Alkebuleum.
          </span>
        </label>
      )}

      {isConnected && address && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>
          Bridging address: <span style={{ fontFamily: 'DM Mono', color: 'var(--white)' }}>{address}</span>
          {direction === 'burn-to-release' && (balances.bnbGasRaw ?? 0n) === 0n && (
            <div style={{ marginTop: 4, color: 'var(--red)' }}>
              Send a small amount of BNB (e.g. 0.005 BNB) to this address on BNB Chain to cover gas.
            </div>
          )}
        </div>
      )}

      <BridgeSummary
        sourceNetwork={sourceNetwork(direction)}
        destinationNetwork={destinationNetwork(direction)}
        destinationAmountDisplay={amount || '0'}
        requiredGasAsset={direction === 'lock-to-mint' ? 'ALKE (Alkebuleum)' : 'BNB (BNB Chain)'}
        gasBalanceRaw={direction === 'burn-to-release' ? balances.bnbGasRaw : null}
      />

      <button
        className={`jlf-action${!isConnected ? '' : !canSubmit ? ' idle' : ''}`}
        disabled={isConnected && !canSubmit}
        onClick={handleSubmit}
      >
        {!isConnected ? 'Connect wallet' : disabledReason ?? 'Bridge ALKE'}
      </button>

      {showProgress && (
        <BridgeProgress
          direction={activeDirection}
          submitPhase={submitPhase}
          submitError={submitError}
          backendState={status.transaction?.state ?? null}
          awaitingDetection={status.awaitingDetection}
          registrationStatus={burnRegistration.status}
          registrationError={burnRegistration.error}
          sourceTransactionHash={activeTxHash}
          destinationTransactionHash={status.transaction?.destinationTransactionHash ?? null}
          onClose={dismissProgress}
        />
      )}
    </div>
  )
}
