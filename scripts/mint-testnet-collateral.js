// Mint 1,000,000 tUSDT and 1,000,000 tUSDC to the deployer (or TARGET_ADDRESS)
// for UI testing on BSC testnet.
//
// Usage:
//   npx hardhat run scripts/mint-testnet-collateral.js --network bscTestnet

require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const TX_OPTS = { type: 0, gasPrice: 1200000000, gasLimit: 200000 };

async function main() {
  const chainId = 97;
  const [deployer] = await hre.ethers.getSigners();
  const target = process.env.TARGET_ADDRESS || deployer.address;

  const artifactPath = path.join(__dirname, '..', 'deployments', `treasury-${chainId}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Deployment artifact not found: ${artifactPath}`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  console.log('Minting test collateral to:', target);
  for (const tokenAddress of artifact.collaterals) {
    const token = await hre.ethers.getContractAt('MockERC20', tokenAddress);
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    const amount = hre.ethers.parseUnits('1000000', Number(decimals));
    await (await token.mint(target, amount, TX_OPTS)).wait();
    console.log(`Minted 1,000,000 ${symbol} (${decimals} decimals) to ${target}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
