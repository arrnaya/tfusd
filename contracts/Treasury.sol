// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ITFUSD {
    function mintByMaster(address to, uint256 amount) external returns (bool);
    function burnFrom(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title Treasury
 * @notice Upgradeable treasury for TFUSD. Accepts whitelisted stablecoins (USDT/USDC)
 *         and mints TFUSD 1:1 to the depositor. Includes KYC gating, staking pools,
 *         emergency pause, and role-based access control.
 *
 * @dev Uses UUPS proxy pattern. Minter role on TFUSD must be granted to this contract.
 *      Manager roles should be held by a multisig/timelock in production.
 */
contract Treasury is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant KYC_VERIFIER_ROLE = keccak256("KYC_VERIFIER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ── TFUSD token ───────────────────────────────────────────────────────────
    ITFUSD public tfusd;

    // ── Collateral / minting ──────────────────────────────────────────────────
    /// @notice Whitelisted collateral token => accepted
    mapping(address => bool) public acceptedCollateral;
    /// @notice Collateral token => decimals (read at add time)
    mapping(address => uint8) public collateralDecimals;
    /// @notice Collateral token => total units held
    mapping(address => uint256) public totalCollateral;
    /// @notice Whitelisted collateral tokens (may include removed tokens)
    address[] public collateralList;
    /// @notice Token already added to collateralList
    mapping(address => bool) public collateralListed;
    /// @notice Total TFUSD minted through this treasury
    uint256 public totalTFUSDMinted;

    /// @notice Max TFUSD mintable in a single transaction
    uint256 public maxMintPerTx;
    /// @notice Max TFUSD mintable per day in aggregate
    uint256 public maxMintPerDay;
    /// @notice Global mint cap in TFUSD
    uint256 public globalMintCap;
    /// @notice day (block.timestamp / 1 days) => TFUSD minted
    mapping(uint256 => uint256) public dailyMintTotal;
    /// @notice user => total TFUSD ever minted (for KYC gating)
    mapping(address => uint256) public totalMintedByUser;

    // ── KYC ───────────────────────────────────────────────────────────────────
    struct KYCInfo {
        bool passed;
        uint256 expiry;
    }
    mapping(address => KYCInfo) public kycInfo;
    /// @notice Mint/stake amount above this threshold requires valid KYC
    uint256 public kycThreshold;
    /// @notice Default KYC validity period (365 days)
    uint256 public kycValidityPeriod;

    // ── Flexible staking ──────────────────────────────────────────────────────
    uint256 public flexibleTotalStaked;
    uint256 public flexibleAccRewardPerShare;
    uint256 public flexibleLastRewardTime;
    /// @notice Reward rate per second for the flexible pool
    uint256 public flexibleRewardRate;
    /// @notice Available reward tokens (TFUSD) for flexible pool
    uint256 public flexibleRewardReserve;

    mapping(address => uint256) public flexibleStake;
    mapping(address => uint256) public flexibleRewardDebt;

    // ── Fixed staking ─────────────────────────────────────────────────────────
    struct FixedPool {
        uint256 lockDuration;
        uint256 apy; // in basis points (10000 = 100%)
        bool active;
    }
    struct FixedStake {
        uint256 amount;
        uint256 startTime;
        uint256 poolId;
        bool claimed;
    }

    uint256 public nextFixedPoolId;
    mapping(uint256 => FixedPool) public fixedPools;
    /// @notice user => array of fixed stakes
    mapping(address => FixedStake[]) public userFixedStakes;
    uint256 public fixedTotalStaked;
    /// @notice TFUSD reserve reserved for fixed-pool rewards
    uint256 public fixedRewardReserve;

    // ── Events ────────────────────────────────────────────────────────────────
    event CollateralAdded(address indexed token);
    event CollateralRemoved(address indexed token);
    event Minted(
        address indexed user,
        address indexed token,
        uint256 tokenAmount,
        uint256 tfusdAmount
    );
    event Redeemed(
        address indexed user,
        address indexed token,
        uint256 tfusdAmount,
        uint256 tokenAmount
    );
    event KYCStatusSet(address indexed user, bool passed, uint256 expiry);
    event KYCRevoked(address indexed user);
    event KYCThresholdUpdated(uint256 newThreshold);
    event MintCapsUpdated(uint256 maxMintPerTx, uint256 maxMintPerDay, uint256 globalMintCap);
    event FlexibleStaked(address indexed user, uint256 amount);
    event FlexibleUnstaked(address indexed user, uint256 amount, uint256 rewards);
    event FlexibleRewardsClaimed(address indexed user, uint256 rewards);
    event FlexibleRewardRateUpdated(uint256 newRate);
    event FixedPoolAdded(uint256 indexed poolId, uint256 lockDuration, uint256 apy);
    event FixedPoolUpdated(uint256 indexed poolId, uint256 lockDuration, uint256 apy);
    event FixedStaked(address indexed user, uint256 indexed poolId, uint256 amount);
    event FixedUnstaked(address indexed user, uint256 indexed poolId, uint256 amount, uint256 rewards);
    event RewardsFunded(uint256 flexibleAmount, uint256 fixedAmount);
    event CollateralWithdrawn(address indexed token, uint256 amount, address indexed to);
    event RewardsWithdrawn(uint256 amount, address indexed to);

    // ── Errors ────────────────────────────────────────────────────────────────
    error InvalidAmount();
    error InvalidToken();
    error TokenNotAccepted();
    error KYCRequired();
    error KYCExpired();
    error MintCapExceeded();
    error DailyMintCapExceeded();
    error GlobalMintCapExceeded();
    error InsufficientCollateral();
    error InsufficientTFUSDBalance();
    error PoolNotFound();
    error PoolNotActive();
    error LockNotExpired();
    error NoFlexibleStake();
    error NothingToClaim();
    error TransferFailed();
    error ZeroAddress();

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier validToken(address token) {
        if (token == address(0)) revert ZeroAddress();
        if (!acceptedCollateral[token]) revert TokenNotAccepted();
        _;
    }

    // ── Initializer ───────────────────────────────────────────────────────────
    function initialize(
        address _tfusd,
        address _admin,
        address _manager,
        address _pauser,
        address _kycVerifier,
        address _upgrader
    ) public initializer {
        if (_tfusd == address(0) || _admin == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();
        _status = _NOT_ENTERED;

        tfusd = ITFUSD(_tfusd);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(TREASURY_MANAGER_ROLE, _manager);
        _grantRole(PAUSER_ROLE, _pauser);
        _grantRole(KYC_VERIFIER_ROLE, _kycVerifier);
        _grantRole(UPGRADER_ROLE, _upgrader);

        // Conservative defaults
        kycThreshold = 5000 * 10 ** 18;
        kycValidityPeriod = 365 days;
        maxMintPerTx = 1_000_000 * 10 ** 18;
        maxMintPerDay = 10_000_000 * 10 ** 18;
        globalMintCap = 500_000_000 * 10 ** 18;
    }

    // ── Admin / collateral management ─────────────────────────────────────────
    function addCollateral(address token) external onlyRole(TREASURY_MANAGER_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        acceptedCollateral[token] = true;
        collateralDecimals[token] = IERC20Metadata(token).decimals();
        if (!collateralListed[token]) {
            collateralListed[token] = true;
            collateralList.push(token);
        }
        emit CollateralAdded(token);
    }

    function removeCollateral(address token) external onlyRole(TREASURY_MANAGER_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        acceptedCollateral[token] = false;
        emit CollateralRemoved(token);
    }

    function setKYCThreshold(uint256 _threshold) external onlyRole(TREASURY_MANAGER_ROLE) {
        kycThreshold = _threshold;
        emit KYCThresholdUpdated(_threshold);
    }

    function setKYCValidityPeriod(uint256 _period) external onlyRole(TREASURY_MANAGER_ROLE) {
        kycValidityPeriod = _period;
    }

    function setMintCaps(
        uint256 _maxMintPerTx,
        uint256 _maxMintPerDay,
        uint256 _globalMintCap
    ) external onlyRole(TREASURY_MANAGER_ROLE) {
        maxMintPerTx = _maxMintPerTx;
        maxMintPerDay = _maxMintPerDay;
        globalMintCap = _globalMintCap;
        emit MintCapsUpdated(_maxMintPerTx, _maxMintPerDay, _globalMintCap);
    }

    // ── KYC ───────────────────────────────────────────────────────────────────
    function setKYCStatus(address user, bool passed) external onlyRole(KYC_VERIFIER_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        uint256 expiry = passed ? block.timestamp + kycValidityPeriod : 0;
        kycInfo[user] = KYCInfo({passed: passed, expiry: expiry});
        emit KYCStatusSet(user, passed, expiry);
    }

    function revokeKYC(address user) external onlyRole(KYC_VERIFIER_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        kycInfo[user].passed = false;
        kycInfo[user].expiry = 0;
        emit KYCRevoked(user);
    }

    function isKYCPassed(address user) public view returns (bool) {
        KYCInfo memory info = kycInfo[user];
        return info.passed && block.timestamp <= info.expiry;
    }

    function _requireKYC(address user, uint256 newTotal) internal view {
        if (newTotal > kycThreshold && !isKYCPassed(user)) revert KYCRequired();
    }

    // ── Deposit & mint ────────────────────────────────────────────────────────
    function depositAndMint(address token, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        validToken(token)
    {
        if (amount == 0) revert InvalidAmount();

        address user = msg.sender;

        // Use balance diff to tolerate fee-on-transfer or rebasing tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(user, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;
        if (received == 0) revert TransferFailed();

        uint256 mintAmount = _normalize(token, received);
        if (mintAmount > maxMintPerTx) revert MintCapExceeded();

        uint256 day = block.timestamp / 1 days;
        if (dailyMintTotal[day] + mintAmount > maxMintPerDay) revert DailyMintCapExceeded();
        if (totalTFUSDMinted + mintAmount > globalMintCap) revert GlobalMintCapExceeded();

        _requireKYC(user, totalMintedByUser[user] + mintAmount);

        // Checks-Effects-Interactions: update state after external transfer
        totalCollateral[token] += received;
        totalTFUSDMinted += mintAmount;
        dailyMintTotal[day] += mintAmount;
        totalMintedByUser[user] += mintAmount;

        bool ok = tfusd.mintByMaster(user, mintAmount);
        if (!ok) revert TransferFailed();

        emit Minted(user, token, received, mintAmount);
    }

    // ── Redeem & burn ─────────────────────────────────────────────────────────
    function redeem(address token, uint256 tfusdAmount)
        external
        whenNotPaused
        nonReentrant
        validToken(token)
    {
        if (tfusdAmount == 0) revert InvalidAmount();

        address user = msg.sender;
        if (tfusd.balanceOf(user) < tfusdAmount) revert InsufficientTFUSDBalance();

        uint256 tokenAmount = _denormalize(token, tfusdAmount);
        if (totalCollateral[token] < tokenAmount) revert InsufficientCollateral();

        totalCollateral[token] -= tokenAmount;
        totalTFUSDMinted -= tfusdAmount;

        tfusd.burnFrom(user, tfusdAmount);
        IERC20(token).safeTransfer(user, tokenAmount);

        emit Redeemed(user, token, tfusdAmount, tokenAmount);
    }

    // ── Flexible staking ──────────────────────────────────────────────────────
    function stakeFlexible(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();

        address user = msg.sender;
        _updateFlexibleRewardPool();

        uint256 currentStake = flexibleStake[user];
        _requireKYC(user, currentStake + amount);

        if (tfusd.balanceOf(user) < amount) revert InsufficientTFUSDBalance();

        // Pull rewards first
        _claimFlexibleRewards(user);

        flexibleStake[user] = currentStake + amount;
        flexibleTotalStaked += amount;
        flexibleRewardDebt[user] = (flexibleStake[user] * flexibleAccRewardPerShare) / 1e18;

        IERC20(address(tfusd)).safeTransferFrom(user, address(this), amount);

        emit FlexibleStaked(user, amount);
    }

    function unstakeFlexible() external whenNotPaused nonReentrant {
        address user = msg.sender;
        uint256 amount = flexibleStake[user];
        if (amount == 0) revert NoFlexibleStake();

        _updateFlexibleRewardPool();
        uint256 rewards = _claimFlexibleRewards(user);

        flexibleTotalStaked -= amount;
        flexibleStake[user] = 0;
        flexibleRewardDebt[user] = 0;

        IERC20(address(tfusd)).safeTransfer(user, amount);

        emit FlexibleUnstaked(user, amount, rewards);
    }

    function claimFlexibleRewards() external whenNotPaused nonReentrant {
        _updateFlexibleRewardPool();
        uint256 rewards = _claimFlexibleRewards(msg.sender);
        if (rewards == 0) revert NothingToClaim();
        emit FlexibleRewardsClaimed(msg.sender, rewards);
    }

    function _updateFlexibleRewardPool() internal {
        if (flexibleTotalStaked == 0) {
            flexibleLastRewardTime = block.timestamp;
            return;
        }
        uint256 timeElapsed = block.timestamp - flexibleLastRewardTime;
        uint256 reward = timeElapsed * flexibleRewardRate;
        if (reward > flexibleRewardReserve) reward = flexibleRewardReserve;
        flexibleAccRewardPerShare += (reward * 1e18) / flexibleTotalStaked;
        flexibleRewardReserve -= reward;
        flexibleLastRewardTime = block.timestamp;
    }

    function _pendingFlexibleRewards(address user) internal view returns (uint256) {
        uint256 acc = flexibleAccRewardPerShare;
        if (flexibleTotalStaked > 0) {
            uint256 timeElapsed = block.timestamp - flexibleLastRewardTime;
            uint256 reward = timeElapsed * flexibleRewardRate;
            if (reward > flexibleRewardReserve) reward = flexibleRewardReserve;
            acc += (reward * 1e18) / flexibleTotalStaked;
        }
        return (flexibleStake[user] * acc) / 1e18 - flexibleRewardDebt[user];
    }

    function _claimFlexibleRewards(address user) internal returns (uint256) {
        uint256 rewards = _pendingFlexibleRewards(user);
        if (rewards > 0) {
            flexibleRewardDebt[user] = (flexibleStake[user] * flexibleAccRewardPerShare) / 1e18;
            IERC20(address(tfusd)).safeTransfer(user, rewards);
        }
        return rewards;
    }

    function setFlexibleRewardRate(uint256 rate) external onlyRole(TREASURY_MANAGER_ROLE) {
        _updateFlexibleRewardPool();
        flexibleRewardRate = rate;
        emit FlexibleRewardRateUpdated(rate);
    }

    // ── Fixed staking ─────────────────────────────────────────────────────────
    function addFixedPool(uint256 lockDuration, uint256 apy)
        external
        onlyRole(TREASURY_MANAGER_ROLE)
        returns (uint256 poolId)
    {
        poolId = nextFixedPoolId++;
        fixedPools[poolId] = FixedPool(lockDuration, apy, true);
        emit FixedPoolAdded(poolId, lockDuration, apy);
    }

    function updateFixedPool(
        uint256 poolId,
        uint256 lockDuration,
        uint256 apy,
        bool active
    ) external onlyRole(TREASURY_MANAGER_ROLE) {
        FixedPool storage pool = fixedPools[poolId];
        if (pool.lockDuration == 0 && pool.apy == 0 && !pool.active) revert PoolNotFound();
        pool.lockDuration = lockDuration;
        pool.apy = apy;
        pool.active = active;
        emit FixedPoolUpdated(poolId, lockDuration, apy);
    }

    function stakeFixed(uint256 poolId, uint256 amount) external whenNotPaused nonReentrant {
        FixedPool memory pool = fixedPools[poolId];
        if (pool.lockDuration == 0 && pool.apy == 0 && !pool.active) revert PoolNotFound();
        if (!pool.active) revert PoolNotActive();
        if (amount == 0) revert InvalidAmount();

        address user = msg.sender;
        _requireKYC(user, amount);
        if (tfusd.balanceOf(user) < amount) revert InsufficientTFUSDBalance();

        userFixedStakes[user].push(
            FixedStake({
                amount: amount,
                startTime: block.timestamp,
                poolId: poolId,
                claimed: false
            })
        );
        fixedTotalStaked += amount;

        IERC20(address(tfusd)).safeTransferFrom(user, address(this), amount);

        emit FixedStaked(user, poolId, amount);
    }

    function unstakeFixed(uint256 stakeIndex) external whenNotPaused nonReentrant {
        address user = msg.sender;
        FixedStake[] storage stakes = userFixedStakes[user];
        if (stakeIndex >= stakes.length) revert PoolNotFound();

        FixedStake storage stake = stakes[stakeIndex];
        if (stake.claimed) revert NothingToClaim();

        FixedPool memory pool = fixedPools[stake.poolId];
        uint256 maturity = stake.startTime + pool.lockDuration;
        if (block.timestamp < maturity) revert LockNotExpired();

        uint256 rewards = _fixedRewards(stake.amount, pool.apy, pool.lockDuration);
        if (rewards > fixedRewardReserve) revert InsufficientCollateral();

        stake.claimed = true;
        fixedTotalStaked -= stake.amount;
        fixedRewardReserve -= rewards;

        IERC20(address(tfusd)).safeTransfer(user, stake.amount + rewards);

        emit FixedUnstaked(user, stake.poolId, stake.amount, rewards);
    }

    function _fixedRewards(
        uint256 amount,
        uint256 apy,
        uint256 lockDuration
    ) internal pure returns (uint256) {
        // reward = amount * apy * lockDuration / (365 days * 10000)
        return (amount * apy * lockDuration) / (365 days * 10000);
    }

    // ── Reward funding / manager functions ────────────────────────────────────
    function fundRewards(uint256 flexibleAmount, uint256 fixedAmount)
        external
        onlyRole(TREASURY_MANAGER_ROLE)
        nonReentrant
    {
        uint256 total = flexibleAmount + fixedAmount;
        if (tfusd.balanceOf(msg.sender) < total) revert InsufficientTFUSDBalance();

        flexibleRewardReserve += flexibleAmount;
        fixedRewardReserve += fixedAmount;

        // Pull TFUSD from manager to this contract
        // Using low-level transferFrom via SafeERC20
        IERC20(address(tfusd)).safeTransferFrom(msg.sender, address(this), total);

        emit RewardsFunded(flexibleAmount, fixedAmount);
    }

    function withdrawRewards(uint256 amount, address to)
        external
        onlyRole(TREASURY_MANAGER_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = flexibleRewardReserve + fixedRewardReserve;
        if (amount > available) revert InsufficientCollateral();

        // Reduce from flexible reserve first, then fixed
        if (amount <= flexibleRewardReserve) {
            flexibleRewardReserve -= amount;
        } else {
            uint256 fromFixed = amount - flexibleRewardReserve;
            flexibleRewardReserve = 0;
            fixedRewardReserve -= fromFixed;
        }

        IERC20(address(tfusd)).safeTransfer(to, amount);
        emit RewardsWithdrawn(amount, to);
    }

    function managerWithdrawCollateral(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(TREASURY_MANAGER_ROLE) nonReentrant validToken(token) {
        if (to == address(0)) revert ZeroAddress();
        if (amount > totalCollateral[token]) revert InsufficientCollateral();

        totalCollateral[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit CollateralWithdrawn(token, amount, to);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function reserveRatio() external view returns (uint256) {
        if (totalTFUSDMinted == 0) return 0;
        uint256 totalCollateralValue = 0;
        // All collateral is normalized to 18 decimals and 1:1 with USD
        for (uint256 i = 0; i < collateralList.length; i++) {
            address token = collateralList[i];
            if (!acceptedCollateral[token]) continue;
            totalCollateralValue += _normalize(token, totalCollateral[token]);
        }
        return (totalCollateralValue * 1e18) / totalTFUSDMinted;
    }

    function pendingFlexibleRewards(address user) external view returns (uint256) {
        return _pendingFlexibleRewards(user);
    }

    function fixedStakeCount(address user) external view returns (uint256) {
        return userFixedStakes[user].length;
    }

    function fixedStakeAt(address user, uint256 index)
        external
        view
        returns (FixedStake memory)
    {
        return userFixedStakes[user][index];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _normalize(address token, uint256 amount) internal view returns (uint256) {
        uint8 decimals = collateralDecimals[token];
        if (decimals == 18) return amount;
        if (decimals < 18) return amount * 10 ** (18 - decimals);
        return amount / 10 ** (decimals - 18);
    }

    function _denormalize(address token, uint256 amount) internal view returns (uint256) {
        uint8 decimals = collateralDecimals[token];
        if (decimals == 18) return amount;
        if (decimals < 18) return amount / 10 ** (18 - decimals);
        return amount * 10 ** (decimals - 18);
    }

    // ── Reentrancy guard (custom upgradeable, OZ v5 compatible) ───────────────
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Treasury: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ── Upgrade authorization ─────────────────────────────────────────────────
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
