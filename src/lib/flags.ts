export const FLAGS = {
  // Phase flags
  V1_HIDE_P2P: true,           // V1: hide P2P UI entry points (keep code for V2)
  V1_ENABLE_MOONPAY: true,     // Show MoonPay option (embed/link)
  V1_ENABLE_EXTERNAL_DEX: true // Show external DEX/bridge options
} as const;
