const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('Treasury', function () {
  let tfusd, usdc, usdt, treasury, impl;
  let owner, admin, manager, pauser, kycVerifier, upgrader, user, user2;

  const ONE = ethers.parseUnits('1', 18);
  const USDC_UNIT = ethers.parseUnits('1', 6);

  async function deployProxy() {
    const TreasuryFactory = await ethers.getContractFactory('Treasury');
    impl = await TreasuryFactory.deploy();
    await impl.waitForDeployment();

    const ProxyFactory = await ethers.getContractFactory('ProxyWrapper');
    const initData = TreasuryFactory.interface.encodeFunctionData('initialize', [
      await tfusd.getAddress(),
      admin.address,
      manager.address,
      pauser.address,
      kycVerifier.address,
      upgrader.address,
    ]);
    const proxy = await ProxyFactory.deploy(await impl.getAddress(), initData);
    await proxy.waitForDeployment();

    return TreasuryFactory.attach(await proxy.getAddress());
  }

  beforeEach(async function () {
    [owner, admin, manager, pauser, kycVerifier, upgrader, user, user2] =
      await ethers.getSigners();

    const MockTFUSD = await ethers.getContractFactory('MockTFUSD');
    tfusd = await MockTFUSD.deploy();
    await tfusd.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    usdc = await MockERC20.deploy('Mock USDC', 'mUSDC', 6);
    await usdc.waitForDeployment();
    usdt = await MockERC20.deploy('Mock USDT', 'mUSDT', 6);
    await usdt.waitForDeployment();

    treasury = await deployProxy();

    // Fund users with collateral
    await usdc.mint(user.address, ethers.parseUnits('1000000', 6));
    await usdt.mint(user.address, ethers.parseUnits('1000000', 6));

    // Fund manager with TFUSD for reward pools (deployer is still minter)
    await tfusd.mintByMaster(manager.address, ethers.parseUnits('1000000', 18));

    // Grant minter role on TFUSD to the treasury
    await tfusd.setMinter(await treasury.getAddress());
  });

  describe('initialization', function () {
    it('sets roles and defaults', async function () {
      expect(await treasury.hasRole(await treasury.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await treasury.hasRole(await treasury.TREASURY_MANAGER_ROLE(), manager.address)).to.be.true;
      expect(await treasury.hasRole(await treasury.PAUSER_ROLE(), pauser.address)).to.be.true;
      expect(await treasury.hasRole(await treasury.KYC_VERIFIER_ROLE(), kycVerifier.address)).to.be.true;
      expect(await treasury.hasRole(await treasury.UPGRADER_ROLE(), upgrader.address)).to.be.true;
      expect(await treasury.kycThreshold()).to.equal(ethers.parseUnits('5000', 18));
    });
  });

  describe('collateral management', function () {
    it('manager can add and remove collateral', async function () {
      await expect(treasury.connect(manager).addCollateral(await usdc.getAddress()))
        .to.emit(treasury, 'CollateralAdded')
        .withArgs(await usdc.getAddress());
      expect(await treasury.acceptedCollateral(await usdc.getAddress())).to.be.true;

      await treasury.connect(manager).removeCollateral(await usdc.getAddress());
      expect(await treasury.acceptedCollateral(await usdc.getAddress())).to.be.false;
    });

    it('non-manager cannot add collateral', async function () {
      await expect(treasury.connect(user).addCollateral(await usdc.getAddress()))
        .to.be.reverted;
    });
  });

  describe('deposit and mint', function () {
    beforeEach(async function () {
      await treasury.connect(manager).addCollateral(await usdc.getAddress());
    });

    it('mints TFUSD 1:1 for USDC', async function () {
      const amount = ethers.parseUnits('1000', 6);
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await expect(treasury.connect(user).depositAndMint(await usdc.getAddress(), amount))
        .to.emit(treasury, 'Minted');
      expect(await tfusd.balanceOf(user.address)).to.equal(ethers.parseUnits('1000', 18));
      expect(await treasury.totalCollateral(await usdc.getAddress())).to.equal(amount);
      expect(await treasury.totalTFUSDMinted()).to.equal(ethers.parseUnits('1000', 18));
    });

    it('requires KYC above threshold', async function () {
      const amount = ethers.parseUnits('6000', 6); // > 5000 TFUSD
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await expect(treasury.connect(user).depositAndMint(await usdc.getAddress(), amount))
        .to.be.revertedWithCustomError(treasury, 'KYCRequired');

      // After KYC passes
      await treasury.connect(kycVerifier).setKYCStatus(user.address, true);
      await treasury.connect(user).depositAndMint(await usdc.getAddress(), amount);
      expect(await tfusd.balanceOf(user.address)).to.equal(ethers.parseUnits('6000', 18));
    });

    it('enforces mint caps', async function () {
      await treasury.connect(manager).setMintCaps(
        ethers.parseUnits('500', 18),
        ethers.parseUnits('10000', 18),
        ethers.parseUnits('500000000', 18)
      );
      const amount = ethers.parseUnits('1000', 6);
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await expect(treasury.connect(user).depositAndMint(await usdc.getAddress(), amount))
        .to.be.revertedWithCustomError(treasury, 'MintCapExceeded');
    });

    it('rejects unaccepted collateral', async function () {
      await expect(treasury.connect(user).depositAndMint(await usdt.getAddress(), USDC_UNIT))
        .to.be.revertedWithCustomError(treasury, 'TokenNotAccepted');
    });
  });

  describe('redeem', function () {
    beforeEach(async function () {
      await treasury.connect(manager).addCollateral(await usdc.getAddress());
      const amount = ethers.parseUnits('1000', 6);
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await treasury.connect(user).depositAndMint(await usdc.getAddress(), amount);
    });

    it('burns TFUSD and returns collateral', async function () {
      const redeemAmount = ethers.parseUnits('400', 18);
      await tfusd.connect(user).approve(await treasury.getAddress(), redeemAmount);
      await expect(treasury.connect(user).redeem(await usdc.getAddress(), redeemAmount))
        .to.emit(treasury, 'Redeemed');
      expect(await tfusd.balanceOf(user.address)).to.equal(ethers.parseUnits('600', 18));
      expect(await usdc.balanceOf(user.address)).to.equal(ethers.parseUnits('999400', 6));
    });
  });

  describe('KYC', function () {
    it('verifier can set and revoke KYC', async function () {
      await treasury.connect(kycVerifier).setKYCStatus(user.address, true);
      expect(await treasury.isKYCPassed(user.address)).to.be.true;
      await treasury.connect(kycVerifier).revokeKYC(user.address);
      expect(await treasury.isKYCPassed(user.address)).to.be.false;
    });

    it('KYC expires after validity period', async function () {
      await treasury.connect(manager).setKYCValidityPeriod(60);
      await treasury.connect(kycVerifier).setKYCStatus(user.address, true);
      expect(await treasury.isKYCPassed(user.address)).to.be.true;
      await ethers.provider.send('evm_increaseTime', [61]);
      await ethers.provider.send('evm_mine');
      expect(await treasury.isKYCPassed(user.address)).to.be.false;
    });
  });

  describe('flexible staking', function () {
    beforeEach(async function () {
      await treasury.connect(manager).addCollateral(await usdc.getAddress());
      await treasury.connect(kycVerifier).setKYCStatus(user.address, true);
      const amount = ethers.parseUnits('10000', 6);
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await treasury.connect(user).depositAndMint(await usdc.getAddress(), amount);
    });

    it('stakes, accrues and claims rewards', async function () {
      const stakeAmount = ethers.parseUnits('1000', 18);
      await tfusd.connect(user).approve(await treasury.getAddress(), stakeAmount);

      // Fund rewards
      const rewardReserve = ethers.parseUnits('10000', 18);
      await tfusd.connect(manager).approve(await treasury.getAddress(), rewardReserve);
      await treasury.connect(manager).fundRewards(rewardReserve, 0);
      await treasury.connect(manager).setFlexibleRewardRate(ethers.parseUnits('1', 18)); // 1 TFUSD/sec

      await treasury.connect(user).stakeFlexible(stakeAmount);
      expect(await treasury.flexibleStake(user.address)).to.equal(stakeAmount);

      await time.increase(100);
      const pending = await treasury.pendingFlexibleRewards(user.address);
      expect(pending).to.be.closeTo(ethers.parseUnits('100', 18), ethers.parseUnits('2', 18));

      const before = await tfusd.balanceOf(user.address);
      await treasury.connect(user).claimFlexibleRewards();
      const after = await tfusd.balanceOf(user.address);
      expect(after - before).to.be.closeTo(pending, ethers.parseUnits('2', 18));
    });

    it('unstakes principal and rewards', async function () {
      const stakeAmount = ethers.parseUnits('1000', 18);
      await tfusd.connect(user).approve(await treasury.getAddress(), stakeAmount);
      const rewardReserve = ethers.parseUnits('10000', 18);
      await tfusd.connect(manager).approve(await treasury.getAddress(), rewardReserve);
      await treasury.connect(manager).fundRewards(rewardReserve, 0);
      await treasury.connect(manager).setFlexibleRewardRate(ethers.parseUnits('1', 18));

      await treasury.connect(user).stakeFlexible(stakeAmount);
      await time.increase(50);

      const before = await tfusd.balanceOf(user.address);
      await treasury.connect(user).unstakeFlexible();
      const after = await tfusd.balanceOf(user.address);
      expect(after - before).to.be.closeTo(
        stakeAmount + ethers.parseUnits('50', 18),
        ethers.parseUnits('2', 18)
      );
      expect(await treasury.flexibleStake(user.address)).to.equal(0);
    });
  });

  describe('fixed staking', function () {
    beforeEach(async function () {
      await treasury.connect(manager).addCollateral(await usdc.getAddress());
      await treasury.connect(kycVerifier).setKYCStatus(user.address, true);
      const amount = ethers.parseUnits('10000', 6);
      await usdc.connect(user).approve(await treasury.getAddress(), amount);
      await treasury.connect(user).depositAndMint(await usdc.getAddress(), amount);
    });

    it('adds pool, stakes and matures', async function () {
      const tx = await treasury.connect(manager).addFixedPool(30 * 86400, 1000); // 30 days, 10% APY
      const receipt = await tx.wait();
      const poolId = 0;

      const rewardReserve = ethers.parseUnits('10000', 18);
      await tfusd.connect(manager).approve(await treasury.getAddress(), rewardReserve);
      await treasury.connect(manager).fundRewards(0, rewardReserve);

      const stakeAmount = ethers.parseUnits('1000', 18);
      await tfusd.connect(user).approve(await treasury.getAddress(), stakeAmount);
      await expect(treasury.connect(user).stakeFixed(poolId, stakeAmount))
        .to.emit(treasury, 'FixedStaked');

      await ethers.provider.send('evm_increaseTime', [30 * 86400 + 1]);
      await ethers.provider.send('evm_mine');

      const before = await tfusd.balanceOf(user.address);
      await treasury.connect(user).unstakeFixed(0);
      const after = await tfusd.balanceOf(user.address);
      // reward = 1000 * 1000 * 30d / (365d * 10000) ~= 8.219 TFUSD
      expect(after - before).to.be.closeTo(
        stakeAmount + ethers.parseUnits('8.219', 18),
        ethers.parseUnits('0.01', 18)
      );
    });

    it('rejects early unstake', async function () {
      await treasury.connect(manager).addFixedPool(30 * 86400, 1000);
      const stakeAmount = ethers.parseUnits('1000', 18);
      await tfusd.connect(user).approve(await treasury.getAddress(), stakeAmount);
      await treasury.connect(user).stakeFixed(0, stakeAmount);
      await expect(treasury.connect(user).unstakeFixed(0))
        .to.be.revertedWithCustomError(treasury, 'LockNotExpired');
    });
  });

  describe('pause', function () {
    it('pauser can pause and unpause minting', async function () {
      await treasury.connect(manager).addCollateral(await usdc.getAddress());
      await treasury.connect(pauser).pause();
      await usdc.connect(user).approve(await treasury.getAddress(), USDC_UNIT);
      await expect(treasury.connect(user).depositAndMint(await usdc.getAddress(), USDC_UNIT))
        .to.be.revertedWithCustomError(treasury, 'EnforcedPause');
      await treasury.connect(pauser).unpause();
      await treasury.connect(user).depositAndMint(await usdc.getAddress(), USDC_UNIT);
    });
  });

  describe('upgrade', function () {
    it('upgrader can upgrade implementation', async function () {
      const TreasuryFactory = await ethers.getContractFactory('Treasury');
      const newImpl = await TreasuryFactory.deploy();
      await newImpl.waitForDeployment();
      await expect(
        treasury.connect(upgrader).upgradeToAndCall(await newImpl.getAddress(), '0x')
      ).to.not.be.reverted;
    });
  });
});
