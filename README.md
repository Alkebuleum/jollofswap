# JollofSwap v2 (React + Vite + Tailwind + TS)

African-focused DEX + P2P onboarding UI. Mocked data/state; ready for integration.

## Quickstart
```bash
npm install
npm run dev
```

## Tech
- React 18 + TypeScript + Vite
- TailwindCSS
- React Router v6
- Zustand state store
- Recharts for charts

## Structure
- `src/pages` – route pages (P2P Buy/Sell, Swap, Liquidity, Farms, Tokens, Wallet, Profile, Settings, Support)
- `src/components` – UI components
- `src/store` – app and P2P stores (mock backends)
- `src/lib` – helpers

## Notes
- All blockchain and chat/escalation flows are mocked for now.
- Replace mock services in `src/store/*` with real APIs and smart contracts.

## Push to Git
git status
git add -A
git commit -m "Improve UX (minimal), fixed Errors"
git push
