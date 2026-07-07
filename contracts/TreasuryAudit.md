# Treasury + Staking Audit Summary

## Scope
- `contracts/Treasury.sol` — upgradeable UUPS treasury with 1:1 mint/redeem, KYC gating, flexible & fixed staking.
- `contracts/mocks/MockTFUSD.sol`, `contracts/mocks/MockERC20.sol`, `contracts/mocks/ProxyWrapper.sol` — test helpers.
- `scripts/deploy-treasury.js` — deterministic proxy deployment script.
- `test/Treasury.test.js` — Hardhat test suite.
- `app/mint/page.tsx`, `app/stake/page.tsx`, `components/PublicAuthContext.tsx`, `components/KYCModal.tsx` — public dApp integration.

## Test Results
```
  Treasury
    initialization
      ✔ sets roles and defaults
    collateral management
      ✔ manager can add and remove collateral
      ✔ non-manager cannot add collateral
    deposit and mint
      ✔ mints TFUSD 1:1 for USDC
      ✔ requires KYC above threshold
      ✔ enforces mint caps
      ✔ rejects unaccepted collateral
    redeem
      ✔ burns TFUSD and returns collateral
    KYC
      ✔ verifier can set and revoke KYC
      ✔ KYC expires after validity period
    flexible staking
      ✔ stakes, accrues and claims rewards
      ✔ unstakes principal and rewards
    fixed staking
      ✔ adds pool, stakes and matures
      ✔ rejects early unstake
    pause
      ✔ pauser can pause and unpause minting
    upgrade
      ✔ upgrader can upgrade implementation

  16 passing
```

## Security Checklist Status

| Control | Status | Notes |
|---|---|---|
| Role-based access control | ✅ | `DEFAULT_ADMIN_ROLE`, `TREASURY_MANAGER_ROLE`, `PAUSER_ROLE`, `KYC_VERIFIER_ROLE`, `UPGRADER_ROLE` |
| UUPS upgradeable with `_authorizeUpgrade` | ✅ | Gated by `UPGRADER_ROLE` |
| Storage gap | ✅ | `uint256[50] __gap` |
| `Pausable` on value-moving functions | ✅ | `depositAndMint`, `redeem`, staking functions use `whenNotPaused` |
| Reentrancy guard | ✅ | Custom upgradeable guard on all value-moving functions |
| CEI pattern | ✅ | State updated before external mint/transfer calls |
| `SafeERC20` for USDT/USDC | ✅ | All token transfers use `safeTransfer` / `safeTransferFrom` |
| Balance-diff accounting | ✅ | `depositAndMint` computes received collateral from before/after balances |
| Decimals normalization | ✅ | Read from `IERC20Metadata.decimals()` at add time |
| KYC gating on-chain | ✅ | `kycThreshold` check using cumulative minted/staked |
| KYC expiry / revocation | ✅ | `kycValidityPeriod`, `revokeKYC` |
| Mint caps (per tx / per day / global) | ✅ | Configurable via `TREASURY_MANAGER_ROLE` |
| Flexible reward accumulator | ✅ | MasterChef-style `accRewardPerShare`, no loops |
| Fixed pools with lock duration & APY | ✅ | Early unstake reverts; rewards capped by funded reserve |
| Pre-funded reward pools | ✅ | `fundRewards` / `withdrawRewards` manager functions |

## Manual Review Findings

### Low / Informational
1. **Email OTP backend**: The public dApp includes a client-side OTP flow. For production, set `NEXT_PUBLIC_OTP_API_URL` to a backend endpoint that sends real emails (Resend/SendGrid/AWS SES) and validates codes server-side.
2. **Ballerine KYC integration**: `NEXT_PUBLIC_BALLERINE_KYC_URL` should point to a self-hosted or managed Ballerine collection flow. On-chain KYC status is written by the `KYC_VERIFIER_ROLE` after off-chain verification.
3. **Fork testing**: Tests use mocks. Run additional fork tests against real BSC/Ethereum USDT & USDC contracts before mainnet launch.
4. **Third-party audit**: A professional audit (CertiK/PeckShield/Trail of Bits) is recommended before large TVL.

### No high or critical findings in the implemented contract code.

## Next Steps
1. Deploy Treasury proxy on target network(s) using `scripts/deploy-treasury.js`.
2. Set `NEXT_PUBLIC_TREASURY_ADDRESS_*` in the frontend environment.
3. Configure production email OTP API and Ballerine KYC URL.
4. Transfer privileged roles from deployer EOA to a multisig/timelock.
5. Run Slither/Mythril and a BSC mainnet fork test campaign.
