// Deploy the upgradeable Treasury contract behind an ERC1967Proxy.
// After deployment, grants MASTERMINTER_ROLE on TFUSD to the Treasury proxy
// and optionally whitelists collateral tokens.
//
// Usage:
//   npx hardhat run scripts/deploy-treasury.js --network bscTestnet
//   npx hardhat run scripts/deploy-treasury.js --network bscMainnet
//
// Required env:
//   - PRIVATE_KEY (deployer with DEFAULT_ADMIN_ROLE on TFUSD)
//   - TFUSD_CONTRACT_ADDRESS or TFUSD_CONTRACT_ADDRESS_TESTNET
// Optional env:
//   - TREASURY_ADMIN, TREASURY_MANAGER, TREASURY_PAUSER, TREASURY_KYC_VERIFIER, TREASURY_UPGRADER
//   - TREASURY_COLLATERAL_TESTNET (comma-separated addresses) — otherwise mocks are deployed on testnet

require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log('Deploying Treasury with:', deployer.address, 'on chain:', chainId);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Deployer balance:', hre.ethers.formatEther(balance), 'BNB');
  if (balance < hre.ethers.parseEther('0.01')) {
    console.warn('WARNING: deployer balance is low; deployment may fail.');
  }

  const tfusdAddress =
    (chainId === 97 ? process.env.TFUSD_CONTRACT_ADDRESS_TESTNET : null) ||
    process.env.TFUSD_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_TFUSD_CONTRACT ||
    '0x0000000000000000000000000000000000000000';
  if (tfusdAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('Set TFUSD_CONTRACT_ADDRESS or TFUSD_CONTRACT_ADDRESS_TESTNET in .env');
  }
  console.log('TFUSD address:', tfusdAddress);

  const admin = process.env.TREASURY_ADMIN || deployer.address;
  const manager = process.env.TREASURY_MANAGER || deployer.address;
  const pauser = process.env.TREASURY_PAUSER || deployer.address;
  const kycVerifier = process.env.TREASURY_KYC_VERIFIER || deployer.address;
  const upgrader = process.env.TREASURY_UPGRADER || deployer.address;

  const Treasury = await hre.ethers.getContractFactory('Treasury');
  const impl = await Treasury.deploy();
  await impl.waitForDeployment();
  console.log('Treasury implementation:', await impl.getAddress());

  const initData = Treasury.interface.encodeFunctionData('initialize', [
    tfusdAddress,
    admin,
    manager,
    pauser,
    kycVerifier,
    upgrader,
  ]);

  const Proxy = await hre.ethers.getContractFactory('ProxyWrapper');
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();

  const treasuryAddress = await proxy.getAddress();
  console.log('Treasury proxy:', treasuryAddress);

  // Grant MASTERMINTER_ROLE on TFUSD to the Treasury proxy
  const TFUSD = await hre.ethers.getContractAt('TreuhandFinanzgruppeUSD', tfusdAddress);
  const MASTERMINTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('MASTERMINTER_ROLE'));
  const tx = await TFUSD.grantRole(MASTERMINTER_ROLE, treasuryAddress);
  await tx.wait();
  console.log('Granted MASTERMINTER_ROLE to Treasury proxy');

  const treasury = Treasury.attach(treasuryAddress);

  // Collateral whitelist
  let collaterals = [];
  if (process.env.TREASURY_COLLATERAL_TESTNET) {
    collaterals = process.env.TREASURY_COLLATERAL_TESTNET.split(',').map((a) => a.trim());
  } else if (chainId === 97) {
    console.log('No TREASURY_COLLATERAL_TESTNET set; deploying mock USDT/USDC for testing');
    const MockERC20 = await hre.ethers.getContractFactory('MockERC20');
    const usdt = await MockERC20.deploy('Testnet USDT', 'tUSDT', 18);
    await usdt.waitForDeployment();
    const usdc = await MockERC20.deploy('Testnet USDC', 'tUSDC', 18);
    await usdc.waitForDeployment();
    collaterals = [await usdt.getAddress(), await usdc.getAddress()];
    console.log('Deployed mock collateral:', collaterals.join(', '));
  } else if (chainId === 56) {
    collaterals = [
      '0x55d398326f99059fF775485246999027B3197955', // USDT
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    ];
  }

  for (const token of collaterals) {
    await (await treasury.addCollateral(token)).wait();
    console.log('Whitelisted collateral:', token);
  }

  // Write a deployment artifact for test scripts / frontend
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const deploymentFile = path.join(deploymentsDir, `treasury-${chainId}.json`);
  fs.writeFileSync(
    deploymentFile,
    JSON.stringify(
      {
        chainId,
        treasuryProxy: treasuryAddress,
        treasuryImplementation: await impl.getAddress(),
        tfusd: tfusdAddress,
        collaterals,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log('Deployment artifact saved to:', deploymentFile);

  console.log('\nAdd the following to your .env for the frontend:');
  const envKey = chainId === 97 ? 'NEXT_PUBLIC_TREASURY_ADDRESS_BSC_TESTNET' : `NEXT_PUBLIC_TREASURY_ADDRESS_${String(network.name).toUpperCase()}`;
  console.log(`${envKey}=${treasuryAddress}`);
  if (chainId === 97 && collaterals.length) {
    console.log(`TREASURY_COLLATERAL_TESTNET=${collaterals.join(',')}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
