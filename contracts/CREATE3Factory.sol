// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CREATE3} from "./utils/CREATE3.sol";

/// @title CREATE3Factory
/// @notice Deterministic cross-chain contract deployment. The deployed address
/// depends only on the factory address and the salt, so the same contract can
/// be deployed at the same address on every EVM chain where this factory exists
/// at the same address.
contract CREATE3Factory {
    event Deployed(bytes32 indexed salt, address indexed deployed);

    /// @notice Deploy arbitrary creation code with a fixed salt.
    /// @param salt Deterministic salt. Same salt + same factory address = same target address.
    /// @param creationCode Full contract creation bytecode (contract bytecode + ABI-encoded constructor args).
    function deploy(bytes32 salt, bytes calldata creationCode) external payable returns (address deployed) {
        deployed = CREATE3.deploy(salt, creationCode, msg.value);
        emit Deployed(salt, deployed);
    }

    /// @notice Predict the address for a given salt.
    function getDeployed(bytes32 salt) external view returns (address) {
        return CREATE3.getDeployed(salt);
    }
}
