Here's a full security-gating checklist to design against before we write a line of Solidity. I've split it into on-chain contract security, token-specific handling, mint/stake gating logic, the off-chain KYC/Wallet bridge (this is the part most teams get wrong), and the audit/test plan.

## 1. On-chain contract architecture & access control

- **Role-based access control (OpenZeppelin `AccessControl`)**, not a single `owner`:
  - `DEFAULT_ADMIN_ROLE` — only for role management, held by a multisig/timelock
  - `TREASURY_MANAGER_ROLE` — withdraw/rebalance collateral, set staking APYs
  - `PAUSER_ROLE` — emergency pause only, separate from admin
  - `KYC_VERIFIER_ROLE` — the only address allowed to write KYC-passed status on-chain (backend signer)
  - `UPGRADER_ROLE` — if upgradeable, gated behind timelock
- **Multisig (Gnosis Safe) for all privileged roles** — no single EOA should ever hold `TREASURY_MANAGER_ROLE` or `DEFAULT_ADMIN_ROLE`.
- **Timelock (48–72h) on**: role grants/revokes, upgrade execution, changing the accepted stablecoin addresses, changing staking pool parameters, changing the KYC threshold (5000 TFUSD).
- **Pausable** (`Pausable`) on mint, stake, unstake, withdraw — separate pause flags per function group so you can freeze minting without freezing withdrawals of principal.
- **Reentrancy guards** (`ReentrancyGuard`) on every function that moves tokens: `mint`, `unstake`, `claimRewards`, `withdrawCollateral`.
- **Checks-Effects-Interactions** strictly enforced — state updates before external calls, always.
- **No `delegatecall` to untrusted addresses**, no arbitrary external call surfaces.
- **Upgradeability decision made explicitly** — if using UUPS/Transparent proxy, `_authorizeUpgrade` gated by timelock + multisig; storage-gap padding for future variables; if not upgradeable, say so and rely on a migration pattern instead.
- **Circuit breakers**: max mint per transaction, max mint per block/day (rate limiting), global mint cap vs actual reserves — mint should never be able to exceed 1:1 backing.
- **No unbounded loops** over user arrays (e.g., don't iterate all stakers on-chain for reward calc — use accumulator/index-based reward math instead, MasterChef-style, not push-based).

## 2. USDT / USDC specific handling

- **Always use OpenZeppelin's `SafeERC20`** (`safeTransfer`, `safeTransferFrom`) — never raw `IERC20.transfer`.
- **USDT (BEP20) does not strictly follow ERC20 return-value spec** in all deployments — some versions return `void` instead of `bool`. `SafeERC20` handles this correctly by checking `returndatasize()`, but you must not write a custom transfer wrapper that assumes a `bool` return.
- **Do not assume fee-on-transfer behavior is impossible** — Tether has upgrade authority and has previously discussed fee mechanisms. Always check actual balance-before/balance-after on deposit rather than trusting the deposited amount equals `amountIn`. This protects against any future fee-on-transfer or rebasing change.
- **USDC upgradeable proxy risk** — USDC contract itself is upgradeable by Circle; don't hardcode assumptions about its bytecode, only interact via the standard ERC20 interface.
- **Decimals normalization** — USDT and USDC on BSC are both 18 decimals typically, but *verify on deployment* (BSC USDT/USDC decimals differ from Ethereum mainnet in some deployments) — never hardcode; read `decimals()` at deploy/config time and normalize to TFUSD's 18 decimals explicitly in a scaling function.
- **Blacklist-aware tokens** — USDT/USDC issuers can blacklist addresses. A transfer *to* the treasury from a blacklisted address will simply revert — handle gracefully, don't let it brick shared state (avoid batch operations that could be griefed by one blacklisted depositor).
- **Only allow deposits of the exact whitelisted token contract addresses** (hardcoded per network, settable only via timelocked governance) — never accept an arbitrary ERC20 "USDT-like" token address.

## 3. Minting gating (TFUSD)

- `mint()` requires:
  1. `whenNotPaused`
  2. Token is in the approved collateral whitelist
  3. Actual received amount verified via balance-diff (see above), not user-supplied amount
  4. 1:1 mint only after successful `transferFrom` completes
  5. **If amount + user's cumulative minted-to-date > 5000 TFUSD → require on-chain KYC-passed flag = true**, else revert with clear reason (`KYCRequired`)
  6. Per-tx and per-day mint caps (anti-flash-loan / anti-manipulation ceiling even for KYC'd users)
- Reserve accounting: contract must track `totalCollateralUSDT`, `totalCollateralUSDC`, `totalTFUSDMinted` and expose a public `reserveRatio()` view — this is your on-chain proof-of-reserve, should be watched by an off-chain monitor + alerting.
- TFUSD token contract itself: `mint` callable only by Treasury contract address (immutable minter reference or role-gated), burn callable by holder or Treasury on redemption.

## 4. Staking gating

- **Flexible pool**: reward accrual via reward-per-token accumulator pattern (not loops), unstake anytime, no lockup, but still subject to the same 5000 TFUSD KYC threshold on *stake* actions (cumulative staked, not just mint).
- **Fixed pools**: lock duration enforced by timestamp, early-unstake either disallowed or penalized (define policy explicitly — don't allow silent bypass of lockup).
- **APY changes** are forward-looking only — never retroactively change accrued-but-unclaimed rewards for existing stakers; changing APY should start a new reward epoch.
- **Reward pool must be pre-funded and capped** — contract should never be able to promise more rewards than `TREASURY_MANAGER_ROLE` has allocated to the reward pool; add a `rewardsAvailable` check that reverts new stakes if the pool can't cover the promised APY at current TVL (or use dynamic/variable APY that adjusts to available rewards).
- **Withdrawal pattern**: pull-based (`claimRewards`, `unstake`) not push-based, to avoid griefing/reentrancy via forced transfers to malicious contracts.
- Same reentrancy guard + CEI pattern as mint.

## 5. Off-chain KYC/Wallet gating (the critical bridge layer)

This is the part that's easy to get wrong — the contract must never "trust the frontend."

- **Wallet Signature** is authentication only — it proves the user controls the wallet, it is *not* KYC and must never set the KYC flag itself.
- **KYC (Ballerine)** result must reach the chain through a **trusted signer/oracle pattern**:
  - Backend runs Ballerine, gets a pass/fail decision.
  - Backend server holds a dedicated `KYC_VERIFIER_ROLE` signing key (ideally in an HSM/KMS, not a plain env var).
  - Contract has `setKYCStatus(address user, bool passed, uint256 expiry, bytes signature)` — verified via ECDSA recovery against the `KYC_VERIFIER_ROLE` key, OR the verifier calls it directly on-chain as a role-gated tx (simpler, avoids signature replay concerns) — direct role-gated call is preferable here since you already have a trusted backend.
  - **Wallet-to-identity binding**: KYC must be tied to the specific wallet address that signed a nonce/challenge proving wallet ownership at KYC time — otherwise a KYC'd user could let an un-KYC'd wallet mint under their status, or a bad actor could get one wallet KYC'd and funnel unlimited minting through it for others (defeats the point). Enforce a signed "I own this wallet" message as part of the Ballerine flow, and store `kycStatus[wallet]`, not `kycStatus[email]`.
  - **KYC status expiry** — set a re-verification interval (e.g., 12 months), don't let a pass be permanent, since documents expire and sanctions lists change.
  - **Revocation path** — `KYC_VERIFIER_ROLE` must be able to revoke status if later flagged (sanctions hit, fraud, chargeback), and revocation should optionally freeze that address's mint/stake (not funds — never lock user's existing withdrawal rights without a legal basis, that's a different can of worms).
- **Session security** (application layer, not the contract, but still "the treasury's" attack surface):
  - JWT/session after Wallet login: short-lived access token + refresh token, httpOnly secure cookies, CSRF protection on any state-changing API call.
  - Backend API that calls `KYC_VERIFIER_ROLE` functions must itself require authenticated session + rate limiting + idempotency keys (prevent replay/duplicate KYC-pass submissions).
- **Frontend must never be the enforcement point** — the 5000 TFUSD threshold check has to be enforced in the *contract*, with the frontend only providing UX (disabling buttons, showing "complete KYC" prompts). Assume a malicious actor calls the contract directly, bypassing your website entirely.

## 6. Operational / process security

- Dedicated deployer address used once, then all admin power transferred to multisig immediately post-deploy — verify deployer key has zero residual privilege.
- Bug bounty (Immunefi or similar) live before mainnet TVL grows.
- Monitoring: real-time alerting on large mints, reserve-ratio deviation, role changes, pause events (Forta/OpenZeppelin Defender or Tenderly alerts).
- Incident response runbook: who can pause, how fast, communication plan.
- No test/staging code paths (backdoors, debug mint functions) left in production bytecode — verify via diff against audited source + Etherscan/BscScan verification.

## 7. Audit & testing plan

- **Static analysis**: Slither, Mythril, Semgrep for Solidity — zero unresolved high/medium findings.
- **Formal invariant tests** (Foundry fuzzing/invariant testing):
  - `totalTFUSDMinted == totalCollateralUSDT + totalCollateralUSDC` (normalized) at all times
  - No mint possible without matching collateral transfer succeeding first
  - No unstake can pay out more than principal + properly accrued rewards
  - Paused state blocks all value-moving functions
- **Unit tests** for every revert path (unauthorized role, exceeds KYC threshold, expired KYC, wrong token, insufficient allowance, blacklisted address, zero-amount, reentrancy attempt via malicious ERC20 mock).
- **Fork tests against real USDT & USDC BEP20 contracts** on a BSC mainnet fork (not mocks) to catch the real non-standard-return-value and decimals behavior.
- **Third-party audit** from a firm with BSC + stablecoin-treasury experience (e.g., CertiK, PeckShield, Trail of Bits) — non-negotiable given TVL exposure — plus a second independent review post-fixes.
- **Testnet KYC/Wallet end-to-end run**: full flow — signup → Wallet → Ballerine KYC → wallet binding → mint above 5000 → stake → unstake → claim — before any mainnet deploy.

## 8. Implementation status

- `contracts/Treasury.sol` is implemented as a single upgradeable UUPS contract covering mint/redeem, KYC gating, flexible staking and fixed staking.
- All checklist items above are reflected in the contract and verified by `test/Treasury.test.js` (16 passing tests).
- See `contracts/TreasuryAudit.md` for the audit summary, test output, and remaining production integration steps (real email OTP backend, Ballerine KYC URL, third-party audit).