// src/lib/nuruSigning.ts
//
// Direct Nuru signing via QR code + Firestore — no WalletConnect relay needed.
//
// Flow:
//   1. JollofSwap calls nuruSign(method, params, chainId, onQr)
//   2. The full signing data is embedded in a QR code (base64 JSON)
//   3. onQr is called so the signing modal can show the QR immediately
//   4. A 'pending' doc is written to Firestore sign_requests/{flowId} for tracking
//   5. User scans QR with Nuru → approves → Nuru writes result to Firestore
//   6. JollofSwap snapshot listener resolves the Promise with the result
//
// Firestore collection: sign_requests/{flowId}
//   pending  → created by JollofSwap when the QR is shown
//   signed   → Nuru approved: result = txHash or signature
//   rejected → Nuru user declined: error = reason string

import { doc, setDoc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../services/firebase'
import { ensureFirebaseGuest } from '../services/firebaseGuest'

const COLLECTION = 'sign_requests'
const TIMEOUT_MS = 180_000 // 3 min

export type NuruSignMethod = 'eth_sendTransaction' | 'personal_sign' | 'eth_sign'

function genFlowId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

/**
 * Request Nuru to sign or submit a transaction via QR code.
 *
 * @param method  EIP-1193 method name
 * @param params  Method params (tx object, message, etc.)
 * @param chainId Target chain ID
 * @param onQr    Called with (flowId, qrPayload) when the QR is ready to show
 * @returns       txHash (for eth_sendTransaction) or signature string
 */
export async function nuruSign(
  method: NuruSignMethod,
  params: any[],
  chainId: number | undefined,
  onQr: (flowId: string, qrPayload: string) => void,
): Promise<string> {
  await ensureFirebaseGuest()

  const flowId = genFlowId()
  const ref = doc(db, COLLECTION, flowId)

  // Write full tx data to Firestore FIRST — Nuru fetches it from here after scanning.
  // The QR only carries the flowId so it stays tiny and scans instantly.
  await setDoc(ref, {
    status: 'pending',
    method,
    params,
    chainId: chainId ?? null,
    createdAt: serverTimestamp(),
  })

  // qrPayload is just the flowId — produces a ~27-char QR, easy to scan
  onQr(flowId, flowId)

  return new Promise<string>((resolve, reject) => {
    let unsub: (() => void) | undefined

    const timer = setTimeout(() => {
      unsub?.()
      deleteDoc(ref).catch(() => {})
      reject(new Error('Nuru did not respond in time. Open Nuru and check for a pending approval.'))
    }, TIMEOUT_MS)

    unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data()
        if (!data) return
        if (data.status === 'signed' && data.result) {
          clearTimeout(timer)
          unsub!()
          resolve(data.result as string)
        } else if (data.status === 'rejected') {
          clearTimeout(timer)
          unsub!()
          deleteDoc(ref).catch(() => {})
          reject(new Error(data.error ?? 'User rejected the request.'))
        }
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Creates a wrapper around any EIP-1193 provider that intercepts all signing
 * methods and routes them through nuruSign (QR + Firestore) instead of relay.
 * Read-only calls (eth_accounts, eth_chainId, etc.) pass through to the real provider.
 */
export function createNuruProvider(
  realProvider: any,
  chainId: number | undefined,
  label: string,
  onBegin: (qrPayload: string) => void,
  onNext: (qrPayload: string) => void,
) {
  let hasBegun = false

  return {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      const signingMethods = ['eth_sendTransaction', 'personal_sign', 'eth_sign']
      if (signingMethods.includes(method)) {
        return nuruSign(
          method as NuruSignMethod,
          params ?? [],
          chainId,
          (_, qrPayload) => {
            if (!hasBegun) {
              onBegin(qrPayload)
              hasBegun = true
            } else {
              onNext(qrPayload)
            }
          },
        )
      }
      return realProvider.request({ method, params })
    },
  }
}
