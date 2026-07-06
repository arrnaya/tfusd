# Agent Notes — TFUSD/Treuhand Finanzgruppe USD

## Project layout
- Next.js 14.2.3 static export (`output: 'export'`, `distDir: 'dist'`).
- Smart contracts in `contracts/`; Hardhat config in `hardhat.config.js`.
- Shared network/contract config in `lib/myusd-config.ts`.
- Live reserve data helper in `lib/reserves.ts`.
- Backend agents in `scripts/`.

## Build & preview
```bash
npm install
npm run build          # produces dist/
npx serve dist -l 3000 # preview at http://localhost:3000
```

## Agents
- `scripts/agent.js` — 30 s audit loop. Safe to run standalone; does **not** send transactions. Optional Telegram alerts via `TELEGRAM_ALERT_ENABLED=true` + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- `scripts/reserve-minter.js` — 15 s MAAL-balance-driven mint/burn agent. **Sends on-chain transactions on BSC Mainnet** when not in dry-run mode. Requires `PRIVATE_KEY` with `MASTERMINTER_ROLE` and BNB for gas.
  - Dry run: `npm run reserve-minter:dry`
  - Live: `npm run reserve-minter` (ensure `.env` is correct and the signer wallet is funded)
  - One-shot test: `RESERVE_MINTER_ONE_SHOT=true npm run reserve-minter:dry`

## Docker (local operations stack)
```bash
docker compose up -d
```
Services:
- `frontend` — static Next.js export via nginx.
- `hardhat` — local BSC mainnet fork.
- `auditor` — audit agent (optional Telegram alerts).
- `reserve-minter` — MAAL auto-mint/burn agent. Defaults to `RESERVE_MINTER_DRY_RUN=true` inside the image for safety; override in `.env` only after verification.

## Security checklist
- `.env` and `.env.example` are **gitignored** and must never be committed.
- Agent containers run as a non-root `node` user.
- RPC URLs containing API keys are sanitized in logs.
- The reserve minter refuses to start if the signer lacks `MASTERMINTER_ROLE`.
- Private keys are read from env only; never logged or baked into images.

## Vercel (frontend only)
- Deploy the static export (`dist/`).
- Required public env var: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
- No private keys, RPC secrets, or minter configuration are needed for the frontend.
