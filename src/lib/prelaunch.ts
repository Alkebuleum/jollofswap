// src/lib/prelaunch.ts
// Controls site-wide prelaunch / waitlist mode.
//
// .env vars:
//   VITE_PRELAUNCH=1              → enable prelaunch gate (0 = fully open)
//   VITE_PRELAUNCH_ALLOWLIST=     → comma-separated AINs that bypass the gate (testers)
//
// When PRELAUNCH=1:
//   - All users see the Waitlist page and cannot access the DEX
//   - Users whose AIN is in PRELAUNCH_ALLOWLIST get full app access

export const PRELAUNCH = String(import.meta.env.VITE_PRELAUNCH ?? '0') === '1'

// Tester AINs — these bypass the prelaunch gate.
// Normalized to uppercase so entries are case-insensitive.
const _raw = (import.meta.env.VITE_PRELAUNCH_ALLOWLIST as string) ?? ''
export const PRELAUNCH_ALLOWLIST: string[] = _raw
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

/**
 * Returns true if this user should bypass the prelaunch gate.
 * Always returns true when PRELAUNCH is off.
 */
export function isAllowedTester(ain: string | null | undefined): boolean {
  if (!PRELAUNCH) return true
  if (!ain) return false
  return PRELAUNCH_ALLOWLIST.includes(String(ain).trim().toUpperCase())
}
