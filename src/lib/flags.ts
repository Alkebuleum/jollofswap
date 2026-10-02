export const FLAGS = {
  // Phase flags
  V1_HIDE_P2P: true,           // V1: hide P2P UI entry points (keep code for V2)
  // New P2P market (src/pages/P2P.tsx — the MAH escrow moved from Nuru).
  // Off = /p2p still works by URL (for testing) but has no nav link.
  P2P_MARKET: false,
  V1_ENABLE_MOONPAY: true,     // Show MoonPay option (embed/link)
  V1_ENABLE_EXTERNAL_DEX: true // Show external DEX/bridge options
} as const;
