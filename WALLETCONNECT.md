# JollofSwap — WalletConnect Working Notes

## Context
Two ways to connect Nuru Wallet to JollofSwap:
1. **WalletConnect** ← working on this first
2. **In-browser injected wallet** (Nuru dApp browser) ← next phase

---

## Current State (as of 2026-06-19)

The WalletConnect v2 integration is **mostly built** but has issues to fix before it can be called working.

### What's Already Done
- `src/lib/wcProvider.ts` — WC v2 provider singleton, URI generation, session restore
- `src/store/wcStore.ts` — connection state (connected bool + address)
- `src/hooks/useWalletConnection.ts` — unified hook (AmVault | WalletConnect)
- `src/components/ConnectWalletModal.tsx` — UI with QR code + copy-paste URI
- `src/hooks/useSignerSession.ts` — transaction signing via WC EIP-1193
- Session persistence — `tryRestoreWcSession()` on app load
- Chain: Alkebuleum only (chain ID `237422`)

### The User Flow (how it's supposed to work)
1. User clicks **Connect wallet** in TopBar
2. `ConnectWalletModal` opens → user clicks **Get Connection Code**
3. `wcConnect()` generates a WalletConnect URI
4. Modal shows QR code OR copy-paste link
5. User opens Nuru Wallet → More → **Connect dApp** → scans QR or pastes URI
6. Nuru approves the session → JollofSwap receives the address
7. TopBar updates to show AIN or short address
8. User can now swap, add liquidity, etc. — all txs route through WC signing

---

## Known Issues to Fix

### 1. WC Project ID is hardcoded in source
- **File:** `src/lib/wcProvider.ts` line ~18
- **Problem:** `168f9f4e2a2a6b550ff1466c8beecfd4` is committed to public repo
- **Fix:** Move to `.env` as `VITE_WC_PROJECT_ID` and read via `import.meta.env`

### 2. WcConnectModal.tsx is dead code
- **File:** `src/components/WcConnectModal.tsx`
- **Problem:** Exists but never imported anywhere — all UI is in `ConnectWalletModal.tsx`
- **Fix:** Delete it

### 3. appStore.ts has stale mock state
- **File:** `src/store/appStore.ts` (or similar)
- **Problem:** Has placeholder `walletConnected` / `connectWallet()` not used in real flow
- **Fix:** Remove or ignore

### 4. No session timeout / expired session handling for WC
- AmVault has a 10-min idle warning + re-auth modal
- WalletConnect has no equivalent — if session expires, user sees errors
- **Fix:** Catch WC provider errors, detect `session_deleted`, auto-show reconnect modal

### 5. Connection error UX
- If `wcConnect()` fails, UI resets but there's no clear recovery message
- User has to manually try again with no guidance
- **Fix:** Show specific error + retry button in modal

---

## Files to Touch

| File | Purpose |
|---|---|
| `src/lib/wcProvider.ts` | Move Project ID to env var |
| `src/components/ConnectWalletModal.tsx` | Improve error + timeout UX |
| `src/components/WcConnectModal.tsx` | Delete (dead code) |
| `src/hooks/useSignerSession.ts` | Handle expired WC session gracefully |
| `.env` | Add `VITE_WC_PROJECT_ID` |

---

## Task List

- [x] Move WC Project ID to `VITE_WC_PROJECT_ID` in `.env` and update `wcProvider.ts`
- [x] Delete `WcConnectModal.tsx`
- [x] Handle expired/deleted WC session (show reconnect prompt instead of error)
- [x] Improve error messaging in `ConnectWalletModal` on failed connect
- [x] Restyle `ConnectWalletModal` to use `jlf-*` dark design system
- [ ] Test full connect → sign → disconnect flow end to end
- [ ] Verify AIN resolution works after WC connect (TopBar shows AIN, not just address)
- [ ] Verify signing works for swap tx end to end on Alkebuleum
- [ ] Verify signing works for bridge (Polygon side) — POL top-up + USDC approve + deposit

---

## Deploy Process (no GitHub Actions)

```
npm run build
# copy CNAME + .nojekyll into dist/
# push dist/ to gh-pages branch via temp git repo
```

See detailed steps in `memory/feedback_deploy.md` (Claude's memory).

---

## Key Notes for Next Session

- **Do not** switch to in-browser wallet work until WC is tested end to end
- The WC Project ID `168f9f4e2a2a6b550ff1466c8beecfd4` is the live key — keep it working
- `useWalletConnection()` returns `connectionType: 'walletconnect'` — always use this hook, never read wcStore directly in components
- Alkebuleum chain ID is `237422` (`0x39F6E`) — hardcoded in wcProvider and useSignerSession
- Relay URL: `https://relay.alkebuleum.com`
