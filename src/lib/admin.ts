// src/lib/admin.ts
// Site admin allowlist — wallets whose AIN appears here can see admin controls
// (e.g. editing the token directory). This only gates UI visibility; the actual
// write still requires signing in with the Firebase admin account (signInAdmin
// in services/firebase.ts) — Firestore security rules enforce that boundary.

const _raw = (import.meta.env.VITE_ADMIN_ALLOWLIST as string) ?? ''
export const ADMIN_ALLOWLIST: string[] = _raw
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

export function isAdminAin(ain: string | null | undefined): boolean {
  if (!ain) return false
  return ADMIN_ALLOWLIST.includes(String(ain).trim().toUpperCase())
}
