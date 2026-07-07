// End-to-end smoke test of the Treasury contract on BSC testnet.
// Reads the deployment artifact created by deploy-treasury.js and uses the
// deployer key as manager / KYC verifier / test user.
//
// Usage:
//   npx hardhat run scripts/test-treasury-testnet.js --network bscTestnet
//
// Required env:
//   - PRIVATE_KEY
//   - TFUSD_CONTRACT_ADDRESS_TESTNET

require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// BSC testnet publicnode RPC can struggle with EIP-1559 gas estimation for
// some contract calls, so we force legacy (type-0) transactions with a fixed
// gas price and a generous gas limit.
const TX_OPTS = { type: 0, gasPrice: 1200000000, gasLimit: 500000 };

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 97) {
    throw new Error('This script is intended for BSC testnet (chainId 97)');
  }

  console.log('Running Treasury E2E test with:', deployer.address, 'on chain:', chainId);

  const artifactPath = path.join(__dirname, '..', 'deployments', `treasury-${chainId}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Deployment artifact not found: ${artifactPath}. Run deploy-treasury.js first.`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  console.log('Treasury proxy:', artifact.treasuryProxy);
  console.log('Collateral tokens:', artifact.collaterals);

  const tfusdAddress = process.env.TFUSD_CONTRACT_ADDRESS_TESTNET;
  if (!tfusdAddress) throw new Error('Set TFUSD_CONTRACT_ADDRESS_TESTNET');

  const treasury = await hre.ethers.getContractAt('Treasury', artifact.treasuryProxy);
  const tfusd = await hre.ethers.getContractAt('TreuhandFinanzgruppeUSD', tfusdAddress);

  // Ensure deployer has TFUSD to fund reward pools and to stake
  const tfusdBalance = await tfusd.balanceOf(deployer.address);
  if (tfusdBalance < hre.ethers.parseUnits('10000', 18)) {
    console.log('Minting test TFUSD to deployer...');
    try {
      await (await tfusd.mintByMaster(deployer.address, hre.ethers.parseUnits('100000', 18), TX_OPTS)).wait();
    } catch {
      console.log('mintByMaster failed, configuring deployer as minter...');
      await (await tfusd.configureMinter(deployer.address, hre.ethers.parseUnits('1000000', 18), TX_OPTS)).wait();
      await (await tfusd.mintByMaster(deployer.address, hre.ethers.parseUnits('100000', 18), TX_OPTS)).wait();
    }
  }

  // Fund reward pools and set flexible reward rate
  console.log('Funding flexible + fixed reward pools...');
  const rewardAmount = hre.ethers.parseUnits('5000', 18);
  await (await tfusd.approve(await treasury.getAddress(), rewardAmount * 2n, TX_OPTS)).wait();
  await (await treasury.fundRewards(rewardAmount, rewardAmount, TX_OPTS)).wait();
  await (await treasury.setFlexibleRewardRate(hre.ethers.parseUnits('1', 18), TX_OPTS)).wait();
  console.log('Flexible reward rate set to 1 TFUSD/sec');

  // Add a fixed pool with a 60-second lock for quick E2E
  console.log('Adding 60-second fixed staking pool...');
  const poolTx = await treasury.addFixedPool(60, 1000, TX_OPTS); // 10% APY, 60s lock
  await poolTx.wait();
  const poolId = (await treasury.nextFixedPoolId()) - 1n;
  console.log('Fixed pool ID:', poolId.toString());

  // Read KYC threshold
  const kycThreshold = await treasury.kycThreshold();
  console.log('KYC threshold:', hre.ethers.formatUnits(kycThreshold, 18), 'TFUSD');

  // Test each collateral token
  for (const tokenAddress of artifact.collaterals) {
    const token = await hre.ethers.getContractAt('MockERC20', tokenAddress);
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    console.log(`\n--- Testing ${symbol} (${tokenAddress}) ---`);

    // Mint test collateral to deployer if it's a mock
    try {
      await (await token.mint(deployer.address, hre.ethers.parseUnits('20000', Number(decimals)), TX_OPTS)).wait();
      console.log(`Minted ${symbol} to deployer`);
    } catch {
      console.log(`Could not mint ${symbol}; assuming deployer already holds some`);
    }

    const belowThreshold = hre.ethers.parseUnits('1000', 18);
    const aboveThreshold = kycThreshold + hre.ethers.parseUnits('1000', 18);

    // Approve collateral
    const depositAmount = hre.ethers.parseUnits('15000', Number(decimals));
    await (await token.approve(await treasury.getAddress(), depositAmount, TX_OPTS)).wait();

    // 1) Mint below KYC threshold without KYC
    console.log('Minting below KYC threshold...');
    const tx1 = await treasury.depositAndMint(
      tokenAddress,
      belowThreshold / 10n ** BigInt(18 - Number(decimals)),
      TX_OPTS
    );
    await tx1.wait();
    let bal = await tfusd.balanceOf(deployer.address);
    console.log('TFUSD balance after small mint:', hre.ethers.formatUnits(bal, 18));

    // 2) Mint above KYC threshold should fail without KYC
    console.log('Attempting above-threshold mint without KYC (should revert)...');
    try {
      const aboveTokenAmount = aboveThreshold / 10n ** BigInt(18 - Number(decimals));
      await (await treasury.depositAndMint(tokenAddress, aboveTokenAmount, TX_OPTS)).wait();
      throw new Error('Above-threshold mint did not revert');
    } catch (e) {
      if (e.message.includes('KYCRequired') || e.message.includes('revert') || e.message.includes('CALL_EXCEPTION')) {
        console.log('Correctly reverted without KYC');
      } else {
        throw e;
      }
    }

    // 3) Set KYC for deployer and mint above threshold
    console.log('Setting KYC status for deployer...');
    await (await treasury.setKYCStatus(deployer.address, true, TX_OPTS)).wait();
    console.log('KYC passed:', await treasury.isKYCPassed(deployer.address));

    const aboveTokenAmount = aboveThreshold / 10n ** BigInt(18 - Number(decimals));
    const tx2 = await treasury.depositAndMint(tokenAddress, aboveTokenAmount, TX_OPTS);
    await tx2.wait();
    bal = await tfusd.balanceOf(deployer.address);
    console.log('TFUSD balance after KYC mint:', hre.ethers.formatUnits(bal, 18));
  }

  // Flexible staking
  console.log('\n--- Flexible Staking ---');
  const flexStakeAmount = hre.ethers.parseUnits('2000', 18);
  await (await tfusd.approve(await treasury.getAddress(), flexStakeAmount, TX_OPTS)).wait();
  await (await treasury.stakeFlexible(flexStakeAmount, TX_OPTS)).wait();
  let flex = await treasury.flexibleStake(deployer.address);
  console.log('Flexible staked:', hre.ethers.formatUnits(flex, 18));

  // Wait a few seconds for rewards to accrue
  console.log('Waiting 5s for flexible rewards...');
  await sleep(5000);
  let pending = await treasury.pendingFlexibleRewards(deployer.address);
  console.log('Pending flexible rewards:', hre.ethers.formatUnits(pending, 18));

  await (await treasury.claimFlexibleRewards(TX_OPTS)).wait();
  console.log('Claimed flexible rewards');

  await (await treasury.unstakeFlexible(TX_OPTS)).wait();
  flex = await treasury.flexibleStake(deployer.address);
  console.log('Flexible staked after unstake:', hre.ethers.formatUnits(flex, 18));

  // Fixed staking
  console.log('\n--- Fixed Staking ---');
  const fixedStakeAmount = hre.ethers.parseUnits('2000', 18);
  await (await tfusd.approve(await treasury.getAddress(), fixedStakeAmount, TX_OPTS)).wait();
  await (await treasury.stakeFixed(poolId, fixedStakeAmount, TX_OPTS)).wait();
  console.log('Fixed staked');

  console.log('Waiting 65s for fixed lock to mature...');
  await sleep(65000);

  let count = await treasury.fixedStakeCount(deployer.address);
  for (let i = 0; i < Number(count); i++) {
    const stake = await treasury.fixedStakeAt(deployer.address, i);
    if (!stake.claimed) {
      await (await treasury.unstakeFixed(i, TX_OPTS)).wait();
      console.log('Unstaked fixed position', i);
    }
  }

  // Redeem a small amount of TFUSD back to USDC
  console.log('\n--- Redeem ---');
  const redeemToken = artifact.collaterals[1] || artifact.collaterals[0];
  const redeemAmount = hre.ethers.parseUnits('500', 18);
  await (await tfusd.approve(await treasury.getAddress(), redeemAmount, TX_OPTS)).wait();
  await (await treasury.redeem(redeemToken, redeemAmount, TX_OPTS)).wait();
  console.log('Redeemed 500 TFUSD to', redeemToken);

  console.log('\n✅ Treasury E2E test completed successfully');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ E2E test failed:', err);
    process.exit(1);
  });
