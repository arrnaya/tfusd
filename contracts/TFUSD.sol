// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title Treuhand Finanzgruppe USD (TFUSD)
 * @dev ERC20-compliant stablecoin with access control, minting governance,
 * blacklist, OTC trade-freeze enforcement (Uniswap V4-aware), and pause.
 * @website: https://tfusd.io
 * @author: TFUSD Stablecoin
 * @version: 1.0.0
 *
 * Why trade-freeze?  Some OTC partners have a no-DEX-sale covenant in their
 * supply agreement.  If they breach that covenant and sell into a DEX, it
 * can damage the peg and liquidity depth.  This contract allows the issuer to
 * freeze only the DEX leg of a wallet's activity, while still allowing P2P
 * transfers and redemption through the issuer.
 *
 * Solution — two-tier restriction model:
 *   ┌─────────────┬─────────────────────────────┬────────────────────┐
 *   │ State       │ P2P transfers (wallet→wallet)│ DEX trades         │
 *   ├─────────────┼─────────────────────────────┼────────────────────┤
 *   │ Normal      │ ✅ Allowed                   │ ✅ Allowed          │
 *   │ TradeFrozen │ ✅ Allowed                   │ ❌ Blocked          │
 *   │ Blacklisted │ ❌ Blocked                   │ ❌ Blocked          │
 *   └─────────────┴─────────────────────────────┴────────────────────┘
 *
 * How V4 enforcement works:
 *   Uniswap V4 is a singleton (PoolManager). ALL pools live inside that
 *   one contract. Flash accounting defers ERC20 settlement to the end of
 *   the unlock callback, but the settlement ALWAYS calls:
 *     ERC20.transferFrom(user, PoolManager, inputAmount)   ← sell leg
 *     ERC20.transfer(PoolManager → user, outputAmount)     ← buy leg
 *   Both trigger TFUSD's _update hook. Registering the PoolManager
 *   address (and the PositionManager for LP operations) is sufficient
 *   to block all V4 activity — no per-pool registration needed.
 *
 *   Also register the Universal Router (which calls transferFrom via
 *   Permit2 on behalf of the user) and Permit2 itself as DEX addresses.
 *
 * Chain addresses (register via bulkAddDexAddresses at deployment):
 *   Ethereum:  PoolManager  0x000000000004444c5dc75cB358380D2e3dE08A90
 *              PosMgr       0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e
 *              UnivRouter   0x66a9893cc07d91d95644aedd05d03f95e1dba8af
 *              Permit2      0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   BSC:       PoolManager  0x28e2ea090877bf75740558f6bfb36a5ffee9e9df
 *              PosMgr       0x7a4a5c919ae2541aed11041a1aeee68f1287f95b
 *              UnivRouter   0x1906c1d672b88cd1b9ac7593301ca990f94eae07
 *              Permit2      0x000000000022D473030F116dDEE9F6B43aC78BA3
 *   (See https://docs.uniswap.org/contracts/v4/deployments for other chains)
 *
 * Roles added:
 *   FREEZER_ROLE    — add/remove wallets from the trade-freeze list
 *   DEX_MANAGER_ROLE — manage the DEX address registry and strict mode
 *
 * @notice Blacklist = total freeze. TradeFrozen = P2P ok, DEX blocked.
 */

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ── Custom errors ────────────────────────────────────────────────────────────
error ZeroAddress();
error NotMinter();
error NotMasterMinter();
error NotPauser();
error NotBlacklister();
error Blacklisted(address account);
error TradeFrozen(address account);
error AmountZero();
error AllowanceExceeded(uint256 requested, uint256 allowed);
error NotInitialized();
error ContractPaused();

// ── Contract ─────────────────────────────────────────────────────────────────
contract TreuhandFinanzgruppeUSD is ERC20, ERC20Burnable, Pausable, Ownable, AccessControl {
    using SafeERC20 for IERC20;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE       = keccak256("MINTER_ROLE");
    bytes32 public constant MASTERMINTER_ROLE = keccak256("MASTERMINTER_ROLE");
    bytes32 public constant PAUSER_ROLE       = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE  = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant RESCUER_ROLE      = keccak256("RESCUER_ROLE");
    bytes32 public constant FREEZER_ROLE      = keccak256("FREEZER_ROLE");      // [NEW v2]
    bytes32 public constant DEX_MANAGER_ROLE  = keccak256("DEX_MANAGER_ROLE"); // [NEW v2]

    // ── State ─────────────────────────────────────────────────────────────────
    string public currency;
    bool private _initialized;

    // Compliance maps
    mapping(address => bool) public blacklisted;
    mapping(address => uint256) public minterAllowance;

    // [NEW v2] Trade-freeze map — wallet → frozen from DEX only
    mapping(address => bool) public tradeFrozen;

    /**
     * DEX address registry.
     * For Uniswap V4, register:
     *   - PoolManager (covers all pool swaps and LP additions/removals)
     *   - PositionManager (periphery that calls transferFrom for LP ops)
     *   - UniversalRouter (routes swaps via Permit2 → PoolManager)
     *   - Permit2 (the canonical transfer proxy used by UniversalRouter)
     * That set of 4 addresses covers 100% of standard V4 interaction paths.
     */
    mapping(address => bool) public isDexAddress;

    // ── Events ────────────────────────────────────────────────────────────────
    event BlacklistedAdded(address indexed account);
    event BlacklistedRemoved(address indexed account);
    event TradeFreezeAdded(address indexed account);     // [NEW v2]
    event TradeFreezeRemoved(address indexed account);   // [NEW v2]
    event DexAddressAdded(address indexed dex);          // [NEW v2]
    event DexAddressRemoved(address indexed dex);        // [NEW v2]
    event ValueReceived(address indexed sender, uint256 amount);
    event MinterConfigured(address indexed minter, uint256 minterAllowedAmount);
    event MinterRemoved(address indexed minter);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyMinter() {
        if (!hasRole(MINTER_ROLE, msg.sender)) revert NotMinter();
        _;
    }
    modifier onlyMasterMinter() {
        if (!hasRole(MASTERMINTER_ROLE, msg.sender)) revert NotMasterMinter();
        _;
    }
    modifier notBlacklisted(address account) {
        if (blacklisted[account]) revert Blacklisted(account);
        _;
    }
    modifier initialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    /**
     * @param _name         Token name (e.g. "Treuhand Finanzgruppe USD")
     * @param _symbol       Token symbol (e.g. "TFUSD")
     * @param _currency     Pegged fiat currency string (e.g. "USD")
     * @param masterMinter  Address granted MASTERMINTER_ROLE
     * @param pauser        Address granted PAUSER_ROLE
     * @param blacklister   Address granted BLACKLISTER_ROLE (also gets FREEZER_ROLE)
     * @param rescuer       Address granted RESCUER_ROLE
     * @param owner_        Address granted DEFAULT_ADMIN_ROLE and ownership
     *                      (also gets DEX_MANAGER_ROLE)
     */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _currency,
        address masterMinter,
        address pauser,
        address blacklister,
        address rescuer,
        address owner_
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        currency     = _currency;
        _initialized = true;

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(MASTERMINTER_ROLE, masterMinter);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(BLACKLISTER_ROLE, blacklister);
        _grantRole(RESCUER_ROLE, rescuer);
        _grantRole(FREEZER_ROLE, blacklister);   // compliance team handles both
        _grantRole(DEX_MANAGER_ROLE, owner_);    // owner curates the DEX registry

        _transferOwnership(owner_);
    }

    receive() external payable {
        emit ValueReceived(msg.sender, msg.value);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BLACKLIST MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    function isBlacklisted(address account) external view returns (bool) {
        return blacklisted[account];
    }

    function addBlacklisted(address account) external onlyRole(BLACKLISTER_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        blacklisted[account] = true;
        emit BlacklistedAdded(account);
    }

    function removeBlacklisted(address account) external onlyRole(BLACKLISTER_ROLE) {
        blacklisted[account] = false;
        emit BlacklistedRemoved(account);
    }

    function bulkAddBlacklisted(address[] calldata accounts) external onlyRole(BLACKLISTER_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            blacklisted[accounts[i]] = true;
            emit BlacklistedAdded(accounts[i]);
        }
    }

    function bulkRemoveBlacklisted(address[] calldata accounts) external onlyRole(BLACKLISTER_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            blacklisted[accounts[i]] = false;
            emit BlacklistedRemoved(accounts[i]);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TRADE FREEZE MANAGEMENT [NEW v2]
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Returns true if the wallet is trade-frozen (DEX blocked, P2P ok).
     */
    function isTradeFrozen(address account) external view returns (bool) {
        return tradeFrozen[account];
    }

    /**
     * @notice Place a wallet under trade freeze.
     *   - Wallet CAN still transfer TFUSD peer-to-peer (wallet to wallet).
     *   - Wallet CANNOT send TFUSD to any registered DEX address (sell/LP).
     *   - Wallet CANNOT receive TFUSD from any registered DEX address (buy).
     *   Use this for OTC partners who breached no-DEX-sale covenants.
     */
    function addTradeFrozen(address account) external onlyRole(FREEZER_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        tradeFrozen[account] = true;
        emit TradeFreezeAdded(account);
    }

    function removeTradeFrozen(address account) external onlyRole(FREEZER_ROLE) {
        tradeFrozen[account] = false;
        emit TradeFreezeRemoved(account);
    }

    /**
     * @notice Bulk freeze — freeze all known wallets of a breaching OTC partner.
     */
    function bulkAddTradeFrozen(address[] calldata accounts) external onlyRole(FREEZER_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            tradeFrozen[accounts[i]] = true;
            emit TradeFreezeAdded(accounts[i]);
        }
    }

    function bulkRemoveTradeFrozen(address[] calldata accounts) external onlyRole(FREEZER_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            tradeFrozen[accounts[i]] = false;
            emit TradeFreezeRemoved(accounts[i]);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DEX ADDRESS REGISTRY
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a DEX-related address.
     *   For Uniswap V4, call this (or bulkAddDexAddresses) at deployment with:
     *     PoolManager, PositionManager, UniversalRouter, Permit2
     *   See contract header comments for per-chain addresses.
     */
    function addDexAddress(address dex) external onlyRole(DEX_MANAGER_ROLE) {
        if (dex == address(0)) revert ZeroAddress();
        isDexAddress[dex] = true;
        emit DexAddressAdded(dex);
    }

    function removeDexAddress(address dex) external onlyRole(DEX_MANAGER_ROLE) {
        isDexAddress[dex] = false;
        emit DexAddressRemoved(dex);
    }

    /**
     * @notice Bulk register DEX addresses in one transaction.
     *   Recommended deployment call:
     *     bulkAddDexAddresses([PoolManager, PositionManager, UniversalRouter, Permit2])
     */
    function bulkAddDexAddresses(address[] calldata dexes) external onlyRole(DEX_MANAGER_ROLE) {
        for (uint256 i = 0; i < dexes.length; i++) {
            if (dexes[i] == address(0)) revert ZeroAddress();
            isDexAddress[dexes[i]] = true;
            emit DexAddressAdded(dexes[i]);
        }
    }

    function bulkRemoveDexAddresses(address[] calldata dexes) external onlyRole(DEX_MANAGER_ROLE) {
        for (uint256 i = 0; i < dexes.length; i++) {
            isDexAddress[dexes[i]] = false;
            emit DexAddressRemoved(dexes[i]);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MINTER MANAGEMENT
    // ══════════════════════════════════════════════════════════════════════════

    function configureMinter(address minter, uint256 allowance_) external onlyMasterMinter {
        _grantRole(MINTER_ROLE, minter);
        minterAllowance[minter] = allowance_;
        emit MinterConfigured(minter, allowance_);
    }

    function removeMinter(address minter) external onlyMasterMinter {
        _revokeRole(MINTER_ROLE, minter);
        minterAllowance[minter] = 0;
        emit MinterRemoved(minter);
    }

    function isMinter(address minter) external view returns (bool) {
        return hasRole(MINTER_ROLE, minter);
    }

    function minterAllowanceOf(address minter) external view returns (uint256) {
        return minterAllowance[minter];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MINTING
    // ══════════════════════════════════════════════════════════════════════════

    function mint(address to, uint256 amount)
        external
        whenNotPaused
        onlyMinter
        notBlacklisted(msg.sender)
        notBlacklisted(to)
        returns (bool)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();
        if (amount > minterAllowance[msg.sender])
            revert AllowanceExceeded(amount, minterAllowance[msg.sender]);
        minterAllowance[msg.sender] -= amount;
        _mint(to, amount);
        return true;
    }

    function mintByMaster(address to, uint256 amount)
        external
        whenNotPaused
        onlyMasterMinter
        notBlacklisted(to)
        returns (bool)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();
        _mint(to, amount);
        return true;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PAUSE
    // ══════════════════════════════════════════════════════════════════════════

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ══════════════════════════════════════════════════════════════════════════
    // CORE TRANSFER HOOK  ← enforcement point for all three restrictions
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Called on every transfer, mint, and burn. Enforcement order:
     *   1. Pause  — reject everything
     *   2. Blacklist — reject if sender or recipient is fully blacklisted
     *   3. Trade freeze — reject only the DEX leg; allow wallet-to-wallet
     *
     * Trade freeze logic for Uniswap V4:
     *   SELLING (frozen wallet → PoolManager):
     *     from = frozen wallet, to = PoolManager → BLOCKED
     *     (also catches PositionManager for LP additions)
     *
     *   BUYING (PoolManager → frozen wallet):
     *     from = PoolManager, to = frozen wallet → BLOCKED
     *     (also catches PositionManager for LP removals)
     *
     *   PERMIT2 path (frozen wallet → UniversalRouter → PoolManager):
     *     UniversalRouter calls transferFrom(frozenWallet, PoolManager, amount)
     *     → from = frozen wallet, to = PoolManager → BLOCKED at PoolManager check
     *
     *   WALLET-TO-WALLET (frozen wallet → another wallet):
     *     Neither address is in isDexAddress → ALLOWED ✅
     *
     * Mint (from == 0) and burn (to == 0) are exempt from trade-freeze
     * so a frozen partner can still redeem TFUSD through the issuer.
     */
    function _update(address from, address to, uint256 amount) internal override {
        // 1. Global pause
        if (paused()) revert ContractPaused();

        // 2. Full blacklist check (both directions)
        if (blacklisted[from]) revert Blacklisted(from);
        if (blacklisted[to])   revert Blacklisted(to);

        // 3. Trade freeze — only applies to live transfers (skip mint/burn)
        if (from != address(0) && to != address(0)) {
            // Frozen wallet selling into or adding LP to a DEX
            if (tradeFrozen[from] && isDexAddress[to]) revert TradeFrozen(from);
            // Frozen wallet buying from or removing LP from a DEX
            if (tradeFrozen[to] && isDexAddress[from]) revert TradeFrozen(to);
        }

        super._update(from, to, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RESCUER
    // ══════════════════════════════════════════════════════════════════════════

    function rescueStuckFunds(address tokenAddress, address to)
        external
        onlyRole(RESCUER_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        if (tokenAddress == address(0)) {
            if (address(this).balance == 0) revert("No ETH balance");
            (bool success, ) = to.call{value: address(this).balance}("");
            if (!success) revert("ETH transfer failed");
        } else {
            uint256 bal = IERC20(tokenAddress).balanceOf(address(this));
            if (bal == 0) revert("No token balance");
            IERC20(tokenAddress).safeTransfer(to, bal);
        }
    }
}
