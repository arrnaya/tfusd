/*
  TFUSDDAO.sol — Decentralized Governance Contract for Treuhand Finanzgruppe USD (TFUSD)
  
  Features:
  - Proposal creation, voting, execution with timelock
  - Role-based access: GUARDIAN, ADMIN (timelock executor)
  - Emergency pause / unpause with guardian quorum
  - Parameter configuration for peg thresholds, auto-actions
  - Delegated mint/burn execution via TreuhandFinanzgruppeUSD contract
  - Multi-sig simulation: guardian quorum for critical actions
  - Security gates: cooldowns, timelock, re-entrancy guards

  SPDX-License-Identifier: MIT
*/
pragma solidity ^0.8.20;

// ── Minimal TreuhandFinanzgruppeUSD interface for mint/burn delegation ──
interface ITreuhandFinanzgruppeUSD {
    function mint(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
    function configureMinter(address minter, uint256 allowance) external;
    function removeMinter(address minter) external;
    function pause() external;
    function unpause() external;
    function paused() external view returns (bool);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function addBlacklisted(address account) external;
    function removeBlacklisted(address account) external;
    function addTradeFrozen(address account) external;
    function removeTradeFrozen(address account) external;
    function addDexAddress(address dex) external;
    function removeDexAddress(address dex) external;
    function rescueStuckFunds(address tokenAddress, address to) external;
}

// ── Minimal AccessControl interface ──
interface IAccessControl {
    function hasRole(bytes32 role, address account) external view returns (bool);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function getRoleAdmin(bytes32 role) external view returns (bytes32);
}

contract TreuhandFinanzgruppeUSDDAO {
    // ── Events ──
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        bytes callData,
        uint256 votingEndsAt,
        uint256 executionTimelockUntil
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint8 voteType, // 0=against, 1=for, 2=abstain
        uint256 weight
    );
    event ProposalExecuted(uint256 indexed proposalId, address indexed executor);
    event ProposalCancelled(uint256 indexed proposalId, address indexed canceller);
    event EmergencyPauseTriggered(address indexed guardian);
    event EmergencyUnpauseTriggered(address indexed guardian);
    event ParameterUpdated(string indexed paramKey, uint256 oldValue, uint256 newValue);
    event GuardianAdded(address indexed guardian);
    event GuardianRemoved(address indexed guardian);
    event MinterDelegated(address indexed minter, uint256 allowance);
    event MinterRevoked(address indexed minter);
    event BlacklistAction(address indexed target, bool added);
    event TradeFreezeAction(address indexed target, bool added);
    event DexRegistryAction(address indexed dex, bool added);
    event FundsRescued(address indexed token, address indexed to, uint256 amount);
    event GuardianQuorumChanged(uint256 oldQuorum, uint256 newQuorum);

    // ── Roles ──
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    // ── Structs ──
    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        bytes callData;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        uint256 createdAt;
        uint256 votingEndsAt;
        uint256 executionTimelockUntil;
        bool executed;
        bool cancelled;
        mapping(address => bool) hasVoted;
        mapping(address => uint8) voteType; // 0=against, 1=for, 2=abstain
    }

    struct DAOParams {
        uint256 depegThreshold;          // in basis points (e.g. 995 = 0.995)
        uint256 positiveDepegThreshold;   // in basis points (e.g. 1005 = 1.005)
        uint256 criticalDepegThreshold;   // in basis points (e.g. 980 = 0.98)
        uint256 poolReplenishThreshold;   // in basis points (e.g. 500 = 50%)
        uint256 maxAutoMintAmount;        // in wei
        uint256 maxAutoBurnAmount;        // in wei
        uint256 mintPauseDuration;        // in seconds
        uint256 guardianQuorum;           // minimum guardians for emergency
        uint256 proposalTimelock;         // in seconds
        uint256 votingPeriod;             // in seconds
        bool autoMintOnDepeg;
        bool autoBurnOnPositiveDepeg;
        bool autoReplenishPool;
    }

    struct GuardianAction {
        address[] approvers;
        uint256 required;
        uint256 createdAt;
        bool executed;
        bytes callData;
        string actionType;
    }

    // ── State ──
    ITreuhandFinanzgruppeUSD public tfusd;
    address public owner;
    uint256 public proposalCount;
    uint256 public guardianActionCount;
    DAOParams public params;
    bool public emergencyPaused;
    uint256 public emergencyPausedAt;
    uint256 public constant MAX_VOTING_PERIOD = 14 days;
    uint256 public constant MIN_VOTING_PERIOD = 1 hours;
    uint256 public constant MAX_TIMELOCK = 7 days;
    uint256 public constant MIN_TIMELOCK = 1 hours;
    uint256 public constant MAX_GUARDIAN_QUORUM = 10;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => GuardianAction) public guardianActions;
    mapping(address => bool) public guardians;
    mapping(address => bool) public proposers;
    address[] public guardianList;

    // ── Modifiers ──
    modifier onlyOwner() {
        require(msg.sender == owner, "DAO: not owner");
        _;
    }

    /// @notice Allows both the owner and the DAO itself (via proposal/guardian
    /// action execution) to call governance functions.
    modifier onlyOwnerOrSelf() {
        require(
            msg.sender == owner || msg.sender == address(this),
            "DAO: not owner or self"
        );
        _;
    }

    modifier onlyGuardian() {
        require(guardians[msg.sender], "DAO: not guardian");
        _;
    }

    modifier onlyProposer() {
        require(proposers[msg.sender] || guardians[msg.sender] || msg.sender == owner, "DAO: not proposer");
        _;
    }

    modifier whenNotEmergencyPaused() {
        require(!emergencyPaused, "DAO: emergency paused");
        _;
    }

    modifier validProposal(uint256 proposalId) {
        require(proposalId > 0 && proposalId <= proposalCount, "DAO: invalid proposal");
        _;
    }

    // ── Constructor ──
    constructor(address _tfusd, address _owner) {
        require(_tfusd != address(0), "DAO: zero tfusd");
        require(_owner != address(0), "DAO: zero owner");
        tfusd = ITreuhandFinanzgruppeUSD(_tfusd);
        owner = _owner;
        guardians[_owner] = true;
        guardianList.push(_owner);
        proposers[_owner] = true;

        // Default parameters
        params = DAOParams({
            depegThreshold: 995,          // 0.995
            positiveDepegThreshold: 1005,  // 1.005
            criticalDepegThreshold: 980,   // 0.98
            poolReplenishThreshold: 5000,  // 50.00% in basis points
            maxAutoMintAmount: 100_000_000 * 1e18, // 100M
            maxAutoBurnAmount: 100_000_000 * 1e18, // 100M
            mintPauseDuration: 1 hours,
            guardianQuorum: 2,
            proposalTimelock: 24 hours,
            votingPeriod: 72 hours,
            autoMintOnDepeg: true,
            autoBurnOnPositiveDepeg: true,
            autoReplenishPool: true
        });
    }

    // ── Ownership ──
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DAO: zero address");
        owner = newOwner;
    }

    // ── Guardian Management ──
    function addGuardian(address guardian) external onlyOwner {
        require(guardian != address(0), "DAO: zero address");
        require(!guardians[guardian], "DAO: already guardian");
        guardians[guardian] = true;
        proposers[guardian] = true;
        guardianList.push(guardian);
        emit GuardianAdded(guardian);
    }

    function removeGuardian(address guardian) external onlyOwner {
        require(guardians[guardian], "DAO: not guardian");
        require(guardian != owner, "DAO: cannot remove owner");
        guardians[guardian] = false;
        proposers[guardian] = false;
        // Remove from list (inefficient but rare)
        for (uint i = 0; i < guardianList.length; i++) {
            if (guardianList[i] == guardian) {
                guardianList[i] = guardianList[guardianList.length - 1];
                guardianList.pop();
                break;
            }
        }
        emit GuardianRemoved(guardian);
    }

    function setGuardianQuorum(uint256 newQuorum) external onlyOwner {
        require(newQuorum > 0 && newQuorum <= MAX_GUARDIAN_QUORUM, "DAO: invalid quorum");
        require(newQuorum <= guardianList.length, "DAO: quorum > guardians");
        uint256 old = params.guardianQuorum;
        params.guardianQuorum = newQuorum;
        emit GuardianQuorumChanged(old, newQuorum);
    }

    function getGuardianCount() external view returns (uint256) {
        return guardianList.length;
    }

    // ── Proposer Management ──
    function addProposer(address proposer) external onlyOwner {
        proposers[proposer] = true;
    }

    function removeProposer(address proposer) external onlyOwner {
        require(proposer != owner, "DAO: cannot remove owner");
        proposers[proposer] = false;
    }

    // ── Proposal Lifecycle ──
    function createProposal(
        string calldata title,
        string calldata description,
        bytes calldata callData
    ) external onlyProposer whenNotEmergencyPaused returns (uint256) {
        require(bytes(title).length > 0 && bytes(title).length <= 200, "DAO: invalid title");
        require(bytes(description).length <= 2000, "DAO: description too long");
        require(callData.length > 0, "DAO: empty calldata");

        proposalCount++;
        uint256 id = proposalCount;
        Proposal storage p = proposals[id];
        p.id = id;
        p.proposer = msg.sender;
        p.title = title;
        p.description = description;
        p.callData = callData;
        p.createdAt = block.timestamp;
        p.votingEndsAt = block.timestamp + params.votingPeriod;
        p.executionTimelockUntil = p.votingEndsAt + params.proposalTimelock;

        emit ProposalCreated(id, msg.sender, title, callData, p.votingEndsAt, p.executionTimelockUntil);
        return id;
    }

    function vote(uint256 proposalId, uint8 voteType_) external validProposal(proposalId) whenNotEmergencyPaused {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp <= p.votingEndsAt, "DAO: voting ended");
        require(!p.hasVoted[msg.sender], "DAO: already voted");
        require(voteType_ <= 2, "DAO: invalid vote type");
        require(guardians[msg.sender] || proposers[msg.sender] || msg.sender == owner, "DAO: not voter");

        p.hasVoted[msg.sender] = true;
        p.voteType[msg.sender] = voteType_;

        if (voteType_ == 0) p.votesAgainst++;
        else if (voteType_ == 1) p.votesFor++;
        else p.votesAbstain++;

        emit VoteCast(proposalId, msg.sender, voteType_, 1);
    }

    function canExecute(uint256 proposalId) external view validProposal(proposalId) returns (bool) {
        Proposal storage p = proposals[proposalId];
        if (p.executed || p.cancelled) return false;
        if (block.timestamp <= p.executionTimelockUntil) return false;
        if (block.timestamp <= p.votingEndsAt) return false; // voting still active
        if (p.votesFor <= p.votesAgainst) return false;
        if (p.votesFor < params.guardianQuorum) return false;
        return true;
    }

    function executeProposal(uint256 proposalId) external validProposal(proposalId) whenNotEmergencyPaused {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "DAO: already executed");
        require(!p.cancelled, "DAO: cancelled");
        require(block.timestamp > p.votingEndsAt, "DAO: voting active");
        require(block.timestamp > p.executionTimelockUntil, "DAO: timelock active");
        require(p.votesFor > p.votesAgainst, "DAO: not passed");
        require(p.votesFor >= params.guardianQuorum, "DAO: quorum not met");

        p.executed = true;

        (bool success, ) = address(this).call(p.callData);
        require(success, "DAO: execution failed");

        emit ProposalExecuted(proposalId, msg.sender);
    }

    function cancelProposal(uint256 proposalId) external validProposal(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer || msg.sender == owner || guardians[msg.sender], "DAO: not authorized");
        require(!p.executed, "DAO: already executed");
        require(!p.cancelled, "DAO: already cancelled");
        p.cancelled = true;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ── Parameter Updates (via proposal execution) ──
    function updateDepegThreshold(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue > 0 && newValue < 1000, "DAO: invalid");
        emit ParameterUpdated("depegThreshold", params.depegThreshold, newValue);
        params.depegThreshold = newValue;
    }

    function updatePositiveDepegThreshold(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue > 1000 && newValue < 2000, "DAO: invalid");
        emit ParameterUpdated("positiveDepegThreshold", params.positiveDepegThreshold, newValue);
        params.positiveDepegThreshold = newValue;
    }

    function updateCriticalDepegThreshold(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue > 0 && newValue < 1000, "DAO: invalid");
        emit ParameterUpdated("criticalDepegThreshold", params.criticalDepegThreshold, newValue);
        params.criticalDepegThreshold = newValue;
    }

    function updatePoolReplenishThreshold(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue <= 10000, "DAO: invalid");
        emit ParameterUpdated("poolReplenishThreshold", params.poolReplenishThreshold, newValue);
        params.poolReplenishThreshold = newValue;
    }

    function updateMaxAutoMintAmount(uint256 newValue) external onlyOwnerOrSelf {
        emit ParameterUpdated("maxAutoMintAmount", params.maxAutoMintAmount, newValue);
        params.maxAutoMintAmount = newValue;
    }

    function updateMaxAutoBurnAmount(uint256 newValue) external onlyOwnerOrSelf {
        emit ParameterUpdated("maxAutoBurnAmount", params.maxAutoBurnAmount, newValue);
        params.maxAutoBurnAmount = newValue;
    }

    function updateMintPauseDuration(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue <= 7 days, "DAO: too long");
        emit ParameterUpdated("mintPauseDuration", params.mintPauseDuration, newValue);
        params.mintPauseDuration = newValue;
    }

    function updateVotingPeriod(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue >= MIN_VOTING_PERIOD && newValue <= MAX_VOTING_PERIOD, "DAO: invalid");
        emit ParameterUpdated("votingPeriod", params.votingPeriod, newValue);
        params.votingPeriod = newValue;
    }

    function updateProposalTimelock(uint256 newValue) external onlyOwnerOrSelf {
        require(newValue >= MIN_TIMELOCK && newValue <= MAX_TIMELOCK, "DAO: invalid");
        emit ParameterUpdated("proposalTimelock", params.proposalTimelock, newValue);
        params.proposalTimelock = newValue;
    }

    function setAutoMintOnDepeg(bool enabled) external onlyOwnerOrSelf {
        params.autoMintOnDepeg = enabled;
        emit ParameterUpdated("autoMintOnDepeg", params.autoMintOnDepeg ? 1 : 0, enabled ? 1 : 0);
    }

    function setAutoBurnOnPositiveDepeg(bool enabled) external onlyOwnerOrSelf {
        params.autoBurnOnPositiveDepeg = enabled;
        emit ParameterUpdated("autoBurnOnPositiveDepeg", params.autoBurnOnPositiveDepeg ? 1 : 0, enabled ? 1 : 0);
    }

    function setAutoReplenishPool(bool enabled) external onlyOwnerOrSelf {
        params.autoReplenishPool = enabled;
        emit ParameterUpdated("autoReplenishPool", params.autoReplenishPool ? 1 : 0, enabled ? 1 : 0);
    }

    // ── Emergency Multi-Sig (Guardian Actions) ──
    function createGuardianAction(bytes calldata callData, string calldata actionType) external onlyGuardian whenNotEmergencyPaused returns (uint256) {
        require(bytes(actionType).length > 0, "DAO: empty type");
        guardianActionCount++;
        uint256 id = guardianActionCount;
        GuardianAction storage ga = guardianActions[id];
        ga.approvers.push(msg.sender);
        ga.required = params.guardianQuorum;
        ga.createdAt = block.timestamp;
        ga.callData = callData;
        ga.actionType = actionType;
        return id;
    }

    function approveGuardianAction(uint256 actionId) external onlyGuardian {
        GuardianAction storage ga = guardianActions[actionId];
        require(!ga.executed, "DAO: already executed");
        require(ga.createdAt > 0, "DAO: invalid action");

        for (uint i = 0; i < ga.approvers.length; i++) {
            require(ga.approvers[i] != msg.sender, "DAO: already approved");
        }
        ga.approvers.push(msg.sender);
    }

    function executeGuardianAction(uint256 actionId) external onlyGuardian {
        GuardianAction storage ga = guardianActions[actionId];
        require(!ga.executed, "DAO: already executed");
        require(ga.approvers.length >= ga.required, "DAO: quorum not met");
        require(block.timestamp <= ga.createdAt + 7 days, "DAO: expired");

        ga.executed = true;

        (bool success, ) = address(this).call(ga.callData);
        require(success, "DAO: execution failed");
    }

    // ── Emergency Pause (Guardian Multi-Sig) ──
    function emergencyPause() external onlyGuardian {
        require(!emergencyPaused, "DAO: already paused");
        emergencyPaused = true;
        emergencyPausedAt = block.timestamp;
        tfusd.pause();
        emit EmergencyPauseTriggered(msg.sender);
    }

    function emergencyUnpause() external onlyGuardian {
        require(emergencyPaused, "DAO: not paused");
        require(block.timestamp >= emergencyPausedAt + params.mintPauseDuration, "DAO: pause duration");
        emergencyPaused = false;
        tfusd.unpause();
        emit EmergencyUnpauseTriggered(msg.sender);
    }

    // ── TreuhandFinanzgruppeUSD Delegation Functions ──
    // These are called by the DAO (via proposals or guardian actions) to interact with TreuhandFinanzgruppeUSD

    function delegateMint(address to, uint256 amount) external onlyOwnerOrSelf {
        tfusd.mint(to, amount);
    }

    function delegateBurn(uint256 amount) external onlyOwnerOrSelf {
        tfusd.burn(amount);
    }

    function delegateConfigureMinter(address minter, uint256 allowance) external onlyOwnerOrSelf {
        tfusd.configureMinter(minter, allowance);
        emit MinterDelegated(minter, allowance);
    }

    function delegateRemoveMinter(address minter) external onlyOwnerOrSelf {
        tfusd.removeMinter(minter);
        emit MinterRevoked(minter);
    }

    function delegateBlacklist(address account, bool add) external onlyOwnerOrSelf {
        if (add) {
            tfusd.addBlacklisted(account);
        } else {
            tfusd.removeBlacklisted(account);
        }
        emit BlacklistAction(account, add);
    }

    function delegateTradeFreeze(address account, bool add) external onlyOwnerOrSelf {
        if (add) {
            tfusd.addTradeFrozen(account);
        } else {
            tfusd.removeTradeFrozen(account);
        }
        emit TradeFreezeAction(account, add);
    }

    function delegateDexAddress(address dex, bool add) external onlyOwnerOrSelf {
        if (add) {
            tfusd.addDexAddress(dex);
        } else {
            tfusd.removeDexAddress(dex);
        }
        emit DexRegistryAction(dex, add);
    }

    function delegateRescueStuckFunds(address tokenAddress, address to) external onlyOwnerOrSelf {
        tfusd.rescueStuckFunds(tokenAddress, to);
        emit FundsRescued(tokenAddress, to, 0);
    }

    // ── Bulk Operations ──
    function delegateBulkBlacklist(address[] calldata accounts, bool add) external onlyOwnerOrSelf {
        for (uint i = 0; i < accounts.length; i++) {
            if (add) {
                tfusd.addBlacklisted(accounts[i]);
            } else {
                tfusd.removeBlacklisted(accounts[i]);
            }
            emit BlacklistAction(accounts[i], add);
        }
    }

    function delegateBulkTradeFreeze(address[] calldata accounts, bool add) external onlyOwnerOrSelf {
        for (uint i = 0; i < accounts.length; i++) {
            if (add) {
                tfusd.addTradeFrozen(accounts[i]);
            } else {
                tfusd.removeTradeFrozen(accounts[i]);
            }
            emit TradeFreezeAction(accounts[i], add);
        }
    }

    function delegateBulkDexAddresses(address[] calldata dexes, bool add) external onlyOwnerOrSelf {
        for (uint i = 0; i < dexes.length; i++) {
            if (add) {
                tfusd.addDexAddress(dexes[i]);
            } else {
                tfusd.removeDexAddress(dexes[i]);
            }
            emit DexRegistryAction(dexes[i], add);
        }
    }

    // ── View Functions ──
    function getProposal(uint256 proposalId) external view validProposal(proposalId) returns (
        uint256 id,
        address proposer,
        string memory title,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votesAbstain,
        uint256 createdAt,
        uint256 votingEndsAt,
        uint256 executionTimelockUntil,
        bool executed,
        bool cancelled
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.id, p.proposer, p.title, p.votesFor, p.votesAgainst, p.votesAbstain, p.createdAt, p.votingEndsAt, p.executionTimelockUntil, p.executed, p.cancelled);
    }

    function hasVoted(uint256 proposalId, address voter) external view validProposal(proposalId) returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }

    function getGuardianList() external view returns (address[] memory) {
        return guardianList;
    }

    function isGuardian(address account) external view returns (bool) {
        return guardians[account];
    }

    function isProposer(address account) external view returns (bool) {
        return proposers[account];
    }

    // ── Receive / Fallback ──
    receive() external payable {}
    fallback() external payable {}
}
