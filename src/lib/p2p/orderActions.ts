// src/lib/p2p/orderActions.ts
//
// Which actions an order offers to the current user — a port of Nuru's
// _OrderCard._availableActions (p2p_tab.dart), plus a taker check so someone
// merely browsing the market never sees a taker-only action.

import type { P2POrder } from './p2pService'

export type OrderAction = 'cancel' | 'commit' | 'accept' | 'markPaid' | 'release' | 'expire' | 'dispute' | 'viewDispute'

export function availableActions(o: P2POrder, myAddresses: string[], nowSec = Date.now() / 1000): { label: string; action: OrderAction; secondary: boolean }[] {
  const mine = new Set(myAddresses.map((a) => a.toLowerCase()))
  const isMaker = mine.has(o.maker.toLowerCase())
  const isTaker = mine.has(o.taker.toLowerCase())
  const sell = o.orderType === 0
  const pastPay = o.status === 1 && o.payDeadline > 0 && nowSec > o.payDeadline
  const A = (label: string, action: OrderAction, secondary = false) => ({ label, action, secondary })

  if (isMaker && sell) { // I'm the seller (posted the offer)
    if (o.status === 0) return [A('Cancel offer', 'cancel', true)]
    if (o.status === 1) return pastPay ? [A('Close (buyer overdue)', 'expire', true)] : [A('Open dispute', 'dispute', true)]
    if (o.status === 2) return [A('Release MAH', 'release'), A('Open dispute', 'dispute', true)]
    if (o.status === 4) return [A('View dispute', 'viewDispute')]
  } else if (!isMaker && sell) { // I'm (or could be) the buyer
    if (o.status === 0) return [A('Accept & buy', 'commit')]
    if (!isTaker) return []
    if (o.status === 1) return [A("I've sent payment", 'markPaid'), A('Open dispute', 'dispute', true)]
    if (o.status === 2) return [A('Open dispute', 'dispute', true)]
    if (o.status === 4) return [A('View dispute', 'viewDispute')]
  } else if (isMaker && !sell) { // I posted the buy request
    if (o.status === 0) return [A('Cancel request', 'cancel', true)]
    if (o.status === 1) return [A("I've sent payment", 'markPaid'), A('Open dispute', 'dispute', true)]
    if (o.status === 4) return [A('View dispute', 'viewDispute')]
  } else { // I'm (or could be) the seller filling a buy request
    if (o.status === 0) return [A('Accept & sell', 'accept')]
    if (!isTaker) return []
    if (o.status === 1) return pastPay ? [A('Close (buyer overdue)', 'expire', true)] : []
    if (o.status === 2) return [A('Release MAH', 'release'), A('Open dispute', 'dispute', true)]
    if (o.status === 4) return [A('View dispute', 'viewDispute')]
  }
  return []
}
