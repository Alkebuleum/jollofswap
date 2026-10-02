// src/lib/p2p/config.ts
//
// MAH P2P escrow + trust layer on Alkebuleum — the same contracts Nuru's P2P
// tab uses (nuru_ai lib/utils/abis/p2p_abi.dart). The header comment there
// names an older escrow (0x4512…); the address below is the one in use.

export const P2P_ESCROW = '0xcABE9eB5a4D293d26C13CEb7ea645fCCe1026f42'
export const P2P_COMMITMENT_REGISTRY = '0x946626B5021861E234CFfECe229e58Fd4f04D10a'
export const P2P_RISK_POLICY_MANAGER = '0x611CBc50491902935e0eBA015EEf70980A81E9D1'
export const REPUTATION_REGISTRY = '0x3828e5673bF9e2F2849839831E3CA60b74C8EB7A'
export const CREDITWORTHINESS_REGISTRY = '0x553910349349DA55D23B85d369fE12fBC98Be87b'

/** AmID registry (v1.4.0) — `controllerOf(bytes32 ain)` decides which address
 *  (Nuru Account or key) trades for an AIN in the escrow. */
export const AMID_REGISTRY = '0xEd2926C4FC57c1539ec74e7bcB0d0AA68B961558'

export const MAH_DECIMALS = 6

// Firestore (shared with Nuru — project amid-7592b)
export const P2P_META_COLLECTION = 'p2p_order_meta'
export const P2P_EVENTS_COLLECTION = 'p2p_events'
export const P2P_DISPUTES_COLLECTION = 'p2p_disputes'

export const OrderType = { sellOffer: 0, buyRequest: 1 } as const

export const OrderStatus = {
  open: 0,
  committed: 1,
  paid: 2,
  released: 3,
  disputed: 4,
  refunded: 5,
  cancelled: 6,
  expired: 7,
} as const

export const STATUS_LABEL: Record<number, string> = {
  0: 'Open',
  1: 'Committed',
  2: 'Paid',
  3: 'Released',
  4: 'Disputed',
  5: 'Refunded',
  6: 'Cancelled',
  7: 'Expired',
}

// TrustTypes.PaymentRail
export const RAIL_LABEL: Record<number, string> = {
  0: 'Crypto',
  1: 'Mobile Money',
  2: 'MoneyGram',
  3: 'Western Union',
  4: 'Bank Transfer',
  5: 'Cash Pickup',
  6: 'Cash in Person',
  7: 'Other',
}
