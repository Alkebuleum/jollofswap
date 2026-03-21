# amvault-connect

A React SDK that lets your dApp authenticate users and send transactions through **AmVault** (popup signer). It provides:

- `<AuthProvider>` + `useAuth()` for sign-in with EIP-191 message signing
- `sendTransaction()` / `sendTransactions()` to route EVM transactions via AmVault popups
- `signMessage()` for arbitrary message signing
- `AmvaultEIP1193Provider` — EIP-1193 compatible provider for use with **ethers.js**, **wagmi**, or **viem**
- Strong nonce / origin / chain checks and customizable sign-in messages
- Lightweight local session (no backend required)

> Built for apps like **AkeOutlet**, **uGov**, and any React dApp on the Alkebuleum blockchain.

---

## Quick start

### 1) Install

```bash
npm i amvault-connect ethers
# TS users: npm i -D @types/react @types/react-dom
```

### 2) Configure env

Create `.env` in your app:

```
VITE_AMVAULT_URL=https://<your-amvault>/router
VITE_CHAIN_ID=237422
VITE_AUTH_DEBUG=true
```

Optional knobs your app may use:

```
VITE_RPC_URL=https://<rpc>
VITE_AKE_DECIMALS=18
VITE_AKE_TOKEN=0x...      # if testing ERC-20 transfer instead of native
VITE_MAX_FEE_GWEI=3
VITE_MAX_PRIORITY_GWEI=1
```

### 3) Wrap your app

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from 'amvault-connect'
import App from './App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider
        config={{
          appName: 'AkeOutlet',
          chainId: Number(import.meta.env.VITE_CHAIN_ID),
          amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
          debug: String(import.meta.env.VITE_AUTH_DEBUG).toLowerCase()==='true',
          // Optional: customize the signin message
          // messageBuilder: ({ appName, origin, chainId, nonce }) => [
          //   `${new URL(origin).host} wants you to sign in with your account:`,
          //   '',
          //   `App: ${appName}`,
          //   `Nonce: ${nonce}`,
          //   `URI: ${origin}`,
          //   `Chain ID: ${chainId}`,
          //   `Version: 1`,
          // ].join('\n'),
          // enforceAppName: true,
          // registry: { isRegistered: async (addr)=>true, getAin: async (addr)=>null },
        }}
      >
        <App/>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
```

### 4) Sign in / out

```jsx
import React from 'react'
import { useAuth } from 'amvault-connect'

export default function Login() {
  const { session, signin, signout, status, error } = useAuth()
  return (
    <div>
      {!session ? (
        <button disabled={status==='checking'} onClick={signin}>
          {status==='checking' ? 'Connecting…' : 'Connect AmVault'}
        </button>
      ) : (
        <>
          <div>Signed in as {session.address} (AIN: {session.ain})</div>
          <button onClick={signout}>Sign out</button>
        </>
      )}
      {error && <div style={{color:'crimson'}}>{error}</div>}
    </div>
  )
}
```

### 5) Protect routes

```jsx
import { Navigate } from 'react-router-dom'
import { useAuth } from 'amvault-connect'

function Protected({ children }) {
  const { session, status } = useAuth()
  if (status === 'checking') return <div>Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}
```

---

## Sending transactions

### Native coin (value transfer)

```js
import { sendTransaction } from 'amvault-connect'
import { parseUnits } from 'ethers'

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID)
const DEST  = '0xYourDestination'
const DECIMALS = 18

async function sendNative(amount) {
  const value = parseUnits(String(amount), DECIMALS)    // BigInt
  const txHash = await sendTransaction(
    {
      chainId: CHAIN,
      to: DEST,
      value: value.toString(),                          // stringify BigInt
      gas: 21000,                                       // skip estimateGas if RPC balks
    },
    { app: 'YourApp', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
  )
  console.log('txHash', txHash)
}
```

### ERC-20 transfer

```js
import { sendTransaction } from 'amvault-connect'
import { Interface, parseUnits } from 'ethers'

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID)
const TOKEN = '0xErc20Address'
const DEST  = '0xRecipient'
const DECIMALS = 18
const iface = new Interface(['function transfer(address to, uint256 amount)'])

async function sendErc20(amount) {
  const value = parseUnits(String(amount), DECIMALS)
  const data  = iface.encodeFunctionData('transfer', [DEST, value])
  const txHash = await sendTransaction(
    {
      chainId: CHAIN,
      to: TOKEN,
      data,
      value: 0,                // number zero is JSON-safe
      gas: 100_000,
    },
    { app: 'YourApp', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
  )
  console.log('txHash', txHash)
}
```

### Batch transactions (multi-tx)

Send multiple transactions in a single popup. AmVault executes them sequentially and returns individual results for each.

```js
import { sendTransactions } from 'amvault-connect'
import { Interface, parseUnits } from 'ethers'

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID)
const iface = new Interface(['function approve(address spender, uint256 amount)',
                              'function deposit(uint256 amount)'])

async function approveAndDeposit(tokenAddr, vaultAddr, amount) {
  const value = parseUnits(String(amount), 18)

  const results = await sendTransactions(
    {
      chainId: CHAIN,
      failFast: true,           // stop on first failure
      txs: [
        {
          to: tokenAddr,
          data: iface.encodeFunctionData('approve', [vaultAddr, value]),
          value: 0,
          gas: 60_000,
        },
        {
          to: vaultAddr,
          data: iface.encodeFunctionData('deposit', [value]),
          value: 0,
          gas: 120_000,
        },
      ],
    },
    { app: 'YourApp', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
  )

  results.forEach((r, i) => {
    if (r.ok) console.log(`tx[${i}] hash:`, r.txHash)
    else console.error(`tx[${i}] failed:`, r.error)
  })
}
```

#### With preflight gas topup (JSwap bridge)

For bridge flows that require native gas on a secondary chain (e.g. Polygon Amoy), pass a `preflight` hint. AmVault will auto-topup gas before executing the batch if the balance is below the minimum.

```js
const results = await sendTransactions(
  {
    chainId: 80002, // Polygon Amoy
    failFast: true,
    preflight: {
      flow: 'bridge_usdc_to_mah',
      gasTopup: {
        enabled: true,
        minBalanceWei: '9000000000000000',    // 0.009 POL — optional hint
        targetBalanceWei: '10000000000000000' // 0.01 POL  — optional hint
      }
    },
    txs: [ /* approve + deposit */ ],
  },
  { app: 'JSwap', amvaultUrl: import.meta.env.VITE_AMVAULT_URL }
)
```

---

## Signing messages

Sign an arbitrary message with the user's AmVault key. Useful for off-chain proofs, permit signatures, and backend authentication flows separate from the main sign-in.

```js
import { signMessage } from 'amvault-connect'

const signature = await signMessage(
  {
    chainId: Number(import.meta.env.VITE_CHAIN_ID),
    message: 'Authorize export of report #42',
  },
  {
    app: 'YourApp',
    amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
  }
)

console.log('signature:', signature)
```

---

## EIP-1193 provider

`AmvaultEIP1193Provider` is a standard [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) compatible provider. This lets you use AmVault with **ethers.js v6**, **wagmi**, **viem**, or any other library that accepts a standard provider — without writing any AmVault-specific code in your dApp logic.

### Setup

```js
import { AmvaultEIP1193Provider } from 'amvault-connect'

const amvault = new AmvaultEIP1193Provider({
  appName: 'AkeOutlet',
  chainId: Number(import.meta.env.VITE_CHAIN_ID),
  amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
  debug: true, // optional
})
```

### With ethers.js v6

```js
import { BrowserProvider } from 'ethers'

const provider = new BrowserProvider(amvault)

// Connect — opens AmVault sign-in popup on first call
const signer = await provider.getSigner()
console.log('address:', await signer.getAddress())

// Send a transaction
const tx = await signer.sendTransaction({
  to: '0xRecipient',
  value: parseUnits('1.0', 18),
})
console.log('txHash:', tx.hash)

// Sign a message
const sig = await signer.signMessage('Hello from AkeOutlet')
console.log('signature:', sig)
```

### With wagmi (custom connector)

```js
import { createConnector } from 'wagmi'
import { AmvaultEIP1193Provider } from 'amvault-connect'

export function amvaultConnector(config) {
  let provider

  return createConnector((wagmiConfig) => ({
    id: 'amvault',
    name: 'AmVault',
    type: 'amvault',

    async connect() {
      provider = new AmvaultEIP1193Provider(config)
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      const chainId = await provider.request({ method: 'eth_chainId' })
      return { accounts, chainId: parseInt(chainId, 16) }
    },

    async disconnect() {
      provider?.disconnect()
    },

    async getProvider() {
      return provider
    },

    async getAccounts() {
      return provider?.request({ method: 'eth_accounts' }) ?? []
    },

    async getChainId() {
      const id = await provider?.request({ method: 'eth_chainId' })
      return parseInt(id, 16)
    },

    onAccountsChanged(accounts) {},
    onChainChanged(chain) {},
    onDisconnect() {},
  }))
}
```

### Supported EIP-1193 methods

| Method | Popup | Description |
|---|---|---|
| `eth_chainId` | No | Returns configured chainId as hex |
| `net_version` | No | Returns chainId as decimal string |
| `eth_accounts` | No | Returns connected address or `[]` |
| `eth_requestAccounts` | Yes (first time) | Sign-in popup; returns address |
| `personal_sign` | Yes | Signs arbitrary message |
| `eth_sign` | Yes | Same as `personal_sign` |
| `eth_sendTransaction` | Yes | Transaction approval popup |
| `wallet_switchEthereumChain` | No | Accepts if same chainId, rejects otherwise |
| `wallet_addEthereumChain` | No | Accepts if same chainId, rejects otherwise |

### Events

```js
amvault.on('accountsChanged', (accounts) => {
  console.log('accounts:', accounts)
})

amvault.on('chainChanged', (chainId) => {
  console.log('chainId:', chainId)
})

amvault.on('connect', ({ chainId }) => {
  console.log('connected to chain:', chainId)
})

amvault.on('disconnect', (error) => {
  console.log('disconnected:', error.message)
})

// Remove a listener
amvault.off('accountsChanged', myHandler)

// Manually disconnect (clears local session)
amvault.disconnect()
```

---

## API Reference

### `<AuthProvider config={{...}}>`

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `appName` | `string` | ✅ | — | Your app's display name; enforced in message by default. |
| `chainId` | `number` | ✅ | — | EVM chain id used for sign-in checks. |
| `amvaultUrl` | `string` | ✅ | — | AmVault router URL for popups. |
| `debug` | `boolean` | — | `false` | Extra console logging. |
| `sessionTtlMs` | `number` | — | `86400000` | Local session TTL (ms). |
| `storagePrefix` | `string` | — | `'amvault'` | localStorage prefix. |
| `registry` | `{ isRegistered(addr):Promise<boolean>, getAin(addr):Promise<string\|null> }` | — | — | Optional on-chain checks to attach roles/AIN. |
| `messageBuilder` | `(info) => string` | — | default SIWE-like | Build the exact sign-in message your app wants the user to sign. |
| `enforceAppName` | `boolean` | — | `true` | Require a `App: <appName>` line in signed message. |

### `useAuth()`

```ts
type Session = { ain: string; address: string; issuedAt: number; expiresAt: number }

{
  session: Session | null,
  signin: () => Promise<void>,
  signout: () => void,
  status: 'idle' | 'checking' | 'ready' | 'failed',
  error: string | null
}
```

### `sendTransaction(req, opts)`

```ts
// req
{
  chainId: number,
  to?: string,
  data?: string,                  // 0x…
  value?: string | number | bigint,
  gas?: number,
  maxFeePerGasGwei?: number,
  maxPriorityFeePerGasGwei?: number,
}

// opts
{
  app: string,
  amvaultUrl: string,
  timeoutMs?: number,
  debug?: boolean,
  keepPopupOpen?: boolean,
}
```

Returns `Promise<string>` (transaction hash).

### `sendTransactions(req, opts)`

```ts
// req
{
  chainId: number,
  txs: Array<{
    to?: string,
    data?: string,
    value?: string | number | bigint,
    gas?: number,
    maxFeePerGasGwei?: number,
    maxPriorityFeePerGasGwei?: number,
  }>,
  failFast?: boolean,             // default true
  preflight?: {
    flow?: 'bridge_usdc_to_mah',
    gasTopup?: {
      enabled: boolean,
      minBalanceWei?: string,
      targetBalanceWei?: string,
    }
  }
}

// opts
{
  app: string,
  amvaultUrl: string,
  timeoutMs?: number,
  debug?: boolean,
  keepPopupOpen?: boolean,
}
```

Returns `Promise<Array<{ ok: boolean, txHash?: string, error?: string }>>`.

### `signMessage(req, opts)`

```ts
// req
{
  chainId: number,
  message: string,
}

// opts
{
  app: string,
  amvaultUrl: string,
  timeoutMs?: number,
  debug?: boolean,
  keepPopupOpen?: boolean,
}
```

Returns `Promise<string>` (hex signature).

### `AmvaultEIP1193Provider`

```ts
const provider = new AmvaultEIP1193Provider(config: AmvaultConnectConfig)

provider.request({ method: string, params?: unknown[] }): Promise<unknown>
provider.on(event, listener): this
provider.off(event, listener): this
provider.removeListener(event, listener): this
provider.disconnect(): void

provider.isAmvault   // true
provider.isMetaMask  // false
```

---

## Custom sign-in message

The SDK sends **the exact message** to AmVault to sign. AmVault echoes it back so verification uses the same string.

```jsx
<AuthProvider
  config={{
    appName: 'YourApp',
    chainId: Number(import.meta.env.VITE_CHAIN_ID),
    amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
    messageBuilder: ({ appName, origin, chainId, nonce }) => [
      `${new URL(origin).host} wants you to sign in with your account:`,
      '',
      `App: ${appName}`,
      `Nonce: ${nonce}`,
      `URI: ${origin}`,
      `Chain ID: ${chainId}`,
      `Version: 1`,
    ].join('\n'),
    enforceAppName: true,
  }}
/>
```

The same `messageBuilder` option is available on `AmvaultEIP1193Provider`.

---

## Troubleshooting

- **Signature invalid (recovered != address):** Sign-in message mismatch. Ensure `appName` / `messageBuilder` matches what the vault signs. The SDK verifies the message echoed by AmVault.
- **UI shows `\n` in message:** Upgrade the vault — new builds normalize JSON-escaped newlines.
- **Do not know how to serialize a BigInt:** `parseUnits()` returns BigInt. Use `value: big.toString()`. Use `0` (number) for zero.
- **estimateGas -32603 Internal error:** Provide `gas` manually (e.g., `21000` native, `100000` ERC-20). Ensure native balance for gas, correct `chainId`, valid contract address.
- **Popup blocked:** Call `eth_requestAccounts` (or `signin`) directly from a user gesture (button click). Browsers block popups opened outside of user interaction.
- **EIP-1193: method not supported:** `AmvaultEIP1193Provider` covers the methods listed above. Methods like `eth_estimateGas` or `eth_call` that require RPC access are not proxied — use a separate JSON-RPC provider for read-only calls.

---

## Security notes

- SDK verifies **nonce**, **origin**, and **chainId** for sign-in.
- Signing **does not** move funds.
- `AmvaultEIP1193Provider` re-uses the same session as `AuthProvider` (shared localStorage key). You do not need both in the same app — pick one pattern.
- For server backends, you can verify the signature server-side using standard `eth_sign` / EIP-191 recovery.

---

## Links

- Repo: https://github.com/Alkebuleum/amvault-connect
- Issues: https://github.com/Alkebuleum/amvault-connect/issues
- Example app: `examples/react-vite` (coming soon)

## License

See [LICENSE](./LICENSE). © 2025 Alkebuleum Technology LLC.