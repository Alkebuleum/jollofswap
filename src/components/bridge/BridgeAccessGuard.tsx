// src/components/bridge/BridgeAccessGuard.tsx
//
// Unauthorized wallets may VIEW the bridge page — only the submit action is
// gated (ALKEBRIDGE.md §2). This component never blocks rendering; it only
// surfaces the disabled reason for the caller to use on the action button.

import type { ReactNode } from 'react'
import { useBridgeAccess } from '../../hooks/bridge/useBridgeAccess'

export default function BridgeAccessGuard({
  children,
}: {
  children: (access: ReturnType<typeof useBridgeAccess>) => ReactNode
}) {
  const access = useBridgeAccess()
  return <>{children(access)}</>
}
