// src/lib/nuruConnect.ts
//
// Firebase-based wallet connection for Nuru.
//
// Instead of WalletConnect pairing, JollofSwap writes a pending connect_request
// to Firestore, shows a tiny QR (`nuru://connect?c={connectId}`), and Nuru
// responds with both addresses:
//   aaWallet  — the smart contract wallet (shown as connected account, used for balance)
//   signer    — the EOA that actually signs transactions
//
// Both apps share the same Firebase guest account, so no auth complexity.
//
// Firestore: connect_requests/{connectId}
//   pending   → created by JollofSwap; user scans with Nuru
//   connected → Nuru approved: aaWallet, signer, ain, primaryHandle
//   rejected  → Nuru declined

import { doc, setDoc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../services/firebase'
import { ensureFirebaseGuest } from '../services/firebaseGuest'

const COLLECTION = 'connect_requests'
const STORAGE_KEY = 'nuru_conn_v1'
const TIMEOUT_MS = 180_000

export interface NuruConnection {
  aaWallet: string
  signer: string
  ain: string
  primaryHandle: string
}

function genConnectId(): string {
  return 'conn_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

export function saveConnection(conn: NuruConnection): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conn)) } catch { /* ignore */ }
}

export function loadConnection(): NuruConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NuruConnection) : null
  } catch { return null }
}

export function clearConnection(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

/**
 * Initiate a Nuru wallet connection via QR + Firestore.
 * Calls onQr(connectId) once the pending doc is written so the UI can show the QR.
 * Resolves when Nuru writes the connection result, rejects on timeout or rejection.
 */
export async function nuruConnect(onQr: (connectId: string) => void): Promise<NuruConnection> {
  await ensureFirebaseGuest()

  const connectId = genConnectId()
  const ref = doc(db, COLLECTION, connectId)

  await setDoc(ref, { status: 'pending', createdAt: serverTimestamp() })
  onQr(connectId)

  return new Promise<NuruConnection>((resolve, reject) => {
    let unsub: (() => void) | undefined

    const timer = setTimeout(() => {
      unsub?.()
      deleteDoc(ref).catch(() => {})
      reject(new Error('Nuru did not respond in time. Make sure Nuru is open and try again.'))
    }, TIMEOUT_MS)

    unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data()
        if (!data) return
        if (data.status === 'connected' && data.aaWallet && data.signer) {
          clearTimeout(timer)
          unsub!()
          const conn: NuruConnection = {
            aaWallet: data.aaWallet as string,
            signer:   data.signer as string,
            ain:            (data.ain as string)          ?? '',
            primaryHandle:  (data.primaryHandle as string) ?? '',
          }
          saveConnection(conn)
          resolve(conn)
        } else if (data.status === 'rejected') {
          clearTimeout(timer)
          unsub!()
          deleteDoc(ref).catch(() => {})
          reject(new Error('Connection rejected in Nuru.'))
        }
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
