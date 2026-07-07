// Deploy the upgradeable Treasury contract behind an ERC1967Proxy.
// After deployment, grants MASTERMINTER_ROLE on TFUSD to the Treasury proxy
// and optionally whitelists collateral tokens.
//
// Usage:
//   npx hardhat run scripts/deploy-treasury.js --network bscMainnet
//
// Required env:
//   - PRIVATE_KEY (deployer with DEFAULT_ADMIN_ROLE on TFUSD)
//   - TFUSD_CONTRACT_ADDRESS
// Optional env:
//   - TREASURY_ADMIN, TREASURY_MANAGER, TREASURY_PAUSER, TREASURY_KYC_VERIFIER, TREASURY_UPGRADER

require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying Treasury with:', deployer.address);

  const tfusdAddress =
    process.env.TFUSD_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_TFUSD_CONTRACT ||
    '0x0000000000000000000000000000000000000000';
  if (tfusdAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('Set TFUSD_CONTRACT_ADDRESS or NEXT_PUBLIC_TFUSD_CONTRACT in .env');
  }

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

  // Optional initial collateral whitelisting on BSC mainnet
  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) === 56) {
    const treasury = Treasury.attach(treasuryAddress);
    const collaterals = [
      '0x55d398326f99059fF775485246999027B3197955', // USDT
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    ];
    for (const token of collaterals) {
      await (await treasury.addCollateral(token)).wait();
      console.log('Whitelisted collateral:', token);
    }
  }

  console.log('\nAdd the following to your .env for the frontend:');
  console.log(`NEXT_PUBLIC_TREASURY_ADDRESS_${String(network.name).toUpperCase()}=${treasuryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
