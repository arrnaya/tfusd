# MyUSD Platform — Full Enterprise Implementation Plan

**Date:** 2026-07-02
**Status:** Phase 2 — Smart Contracts, Enhanced Controls, Audit Agent, Dockerization

---

## 1. Smart Contracts

### TFUSD.sol (EXISTING — ✅)
- ERC20 with mint/burn, role-based access, blacklist, trade freeze, DEX registry, pause
- Already complete at root level

### TFUSDDAO.sol (NEW — ✅ WRITTEN)
- Governance: proposals, voting, execution with timelock
- Guardian multi-sig for emergency actions
- Parameter configuration for peg thresholds, auto-actions
- Delegated MyUSD operations: mint, burn, blacklist, trade freeze, DEX registry, rescue
- Bulk operations: bulkBlacklist, bulkTradeFreeze, bulkDexAddresses
- Security gates: re-entrancy, timelock, cooldown, quorum checks
- Emergency pause/unpause with minimum duration

### Deployment Order
1. Deploy TFUSD.sol (if not already deployed)
2. Deploy TFUSDDAO.sol with TFUSD address
3. Transfer MyUSD ownership to DAO (optional, for full decentralization)
4. Configure DAO as minter on MyUSD

---

## 2. Enhanced Supply Dashboard Controls

### New Controls to Add
- **Blacklist Management**: Search wallet → add/remove blacklist, display blacklisted list
- **Trade Freeze Management**: Search wallet → add/remove trade freeze, display frozen list
- **DEX Registry**: Add/remove DEX addresses, display registered DEXes
- **Bulk Operations**: Multi-address input for bulk blacklist/trade freeze/DEX
- **Minter Management**: Configure minter allowance, remove minter
- **Rescue Funds**: Rescue stuck tokens from contract
- **Role Management**: View role assignments (read-only for most)

### Role Gating
- All delegated operations: GUARDIAN + ADMIN only
- View functions: all authenticated roles

---

## 3. Cross-Component Sync Logic

### Sync Rules
```
DON offline → MyUSDContext checks AdminContext → if any DON offline → minting disabled
DAO emergency paused → MyUSDContext reads DAO contract → paused state → minting disabled
DAO proposal executed (parameter change) → MyUSDContext updates thresholds
Peg depeg detected → MyUSDContext auto-mints (if DAO params allow)
Peg positive-depeg → MyUSDContext auto-burns (if DAO params allow)
Pool low → MyUSDContext auto-replenishes (if DAO params allow)
```

### Implementation
- MyUSDContext polls admin state every 15s
- MyUSDContext polls DAO params every 30s
- Before any manual mint/burn, check: DONs all online + contract not paused + user has permission
- After DAO proposal execution, update MyUSDContext thresholds

---

## 4. Agentic Wallet

### Design
- **Wallet Generation**: Ethers.js HD wallet or single private key
- **Security Gates**:
  1. Transaction signing requires guardian approval (if tx > threshold)
  2. Daily spending limits per role
  3. Multi-sig simulation for large transactions
  4. Emergency pause wallet operations
  5. Whitelist for destination addresses
- **Key Storage**: Encrypted in environment variables (NOT in code)
- **Test BNB Funding**: User provides test BNBs, wallet stores them
- **Transaction Queue**: Pending transactions require approval before execution

### Implementation
- `lib/agentic-wallet.ts` — Wallet creation, signing, transaction queue
- `components/WalletContext.tsx` — Wallet state management
- Security: no private keys in git, all stored in `.env` or Docker secrets

---

## 5. Audit Agent

### Design
- **Continuous Monitoring**: Runs in background (or via cron/interval)
- **Checks**:
  1. Smart contract health (balance, paused status, role assignments)
  2. Peg stability (price vs threshold, deviation frequency)
  3. Pool health (balance vs target, replenish history)
  4. Governance health (active proposals, quorum, voter participation)
  5. Security score (blacklist coverage, access controls, emergency readiness)
  6. DON health (all 4 DONs online, sync status)
  7. Mint/Burn ratio health (supply growth vs burns)
  8. Activity score (transactions, volume, market cap trend)
- **Scoring Algorithm**: Weighted average of 8 categories, 0-100
- **Dashboard Display**: Score badge, category breakdown, recommendations
- **Alerts**: Auto-alert if any category drops below threshold

### Implementation
- `lib/audit-agent.ts` — Scoring engine, checks, recommendations
- `components/AuditAgent.tsx` — UI display component
- `components/AuditContext.tsx` — Context for sharing audit state
- Runs every 30s or on-demand

---

## 6. Docker Containerization

### Structure
```
myusd-platform/
├── docker-compose.yml          # Main orchestration
├── docker/
│   ├── Dockerfile.frontend     # Next.js static build + nginx
│   ├── Dockerfile.hardhat      # Hardhat/Foundry for contract deployment
│   └── Dockerfile.agent        # Audit agent + background workers
├── contracts/                  # Solidity contracts
│   ├── TFUSD.sol
│   └── TFUSDDAO.sol
├── scripts/
│   ├── deploy.js               # Contract deployment
│   ├── agent.js                # Background audit agent
│   └── test.js                 # E2E test suite
├── frontend/                   # Next.js app (current code)
├── .env                        # Environment variables (not in git)
└── README.md
```

### Services
- **frontend**: Nginx serving static Next.js build
- **hardhat**: Local BSC testnet fork + contract deployment
- **agent**: Node.js background process for audit + wallet monitoring

---

## 7. End-to-End Test Flow

```
1. Start Docker containers
2. Deploy TFUSD.sol to BSC testnet
3. Deploy TFUSDDAO.sol with TFUSD address
4. Configure DAO as minter on MyUSD
5. Fund wallet with test BNBs
6. Open frontend → login as admin
7. Check DONs dashboard → all operational
8. Go to Supply → check peg gauge, price data
9. Go to DAO → create proposal → vote → execute
10. Go to Admin → shutdown DON-1 → verify minting disabled
11. Resume DON-1 → verify minting enabled
12. Trigger depeg (set price < 0.995) → verify auto-mint
13. Check audit score → verify all categories green
14. Blacklist test wallet → verify controls work
```

---

## 8. File Map

```
/
├── TFUSD.sol                  ✅ (existing)
├── TFUSDDAO.sol               ✅ (new)
├── docker-compose.yml         🔄 (to create)
├── docker/
│   ├── Dockerfile.frontend    🔄
│   ├── Dockerfile.hardhat      🔄
│   └── Dockerfile.agent        🔄
├── scripts/
│   ├── deploy.js              🔄
│   ├── agent.js               🔄
│   └── test.js               🔄
├── .env.example               🔄
├── .env                       🔄 (user adds secrets)
├── frontend/                  🔄 (current app moved here)
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── ...
```

---

## 9. Current Status (2026-07-02)

✅ TFUSD.sol contract
✅ TFUSDDAO.sol contract
✅ Next.js frontend with dual dashboards
✅ Peg monitoring engine
✅ DAO governance UI
✅ Role-based auth
✅ blackScreen.xml masking
⏳ Docker containers
⏳ Agentic wallet
⏳ Audit agent
⏳ E2E tests
⏳ Enhanced controls (blacklist, trade freeze, bulk)
⏳ Cross-component sync
