export const FLAGS = {
  // Phase flags
  // New P2P market (src/pages/P2P.tsx — the MAH escrow moved from Nuru).
  // Off = /p2p still works by URL (for testing) but has no nav link.
  P2P_MARKET: true,
  // P2P trading (Phase 2) — open to everyone. Kill switch: set false to
  // limit trading to AINs in VITE_P2P_TRADING_AINS (others see read-only).
  P2P_TRADING_OPEN: true,
  V1_ENABLE_MOONPAY: true,     // Show MoonPay option (embed/link)
  V1_ENABLE_EXTERNAL_DEX: true // Show external DEX/bridge options
} as const;
