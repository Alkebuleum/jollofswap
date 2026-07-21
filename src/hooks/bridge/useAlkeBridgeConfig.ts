// src/hooks/bridge/useAlkeBridgeConfig.ts
//
// Thin hook wrapper around the centralized bridge config (src/lib/bridge/config.ts)
// so components pull config through the same hooks/ convention as everything else.

import * as config from '../../lib/bridge/config'

export function useAlkeBridgeConfig() {
  return config
}
