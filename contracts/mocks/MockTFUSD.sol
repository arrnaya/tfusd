// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTFUSD is ERC20 {
    address public minter;

    constructor() ERC20("Mock TFUSD", "mTFUSD") {
        minter = msg.sender;
    }

    function setMinter(address _minter) external {
        minter = _minter;
    }

    function mintByMaster(address to, uint256 amount) external returns (bool) {
        require(msg.sender == minter, "MockTFUSD: not minter");
        _mint(to, amount);
        return true;
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
