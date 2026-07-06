/**
 * Verify all deployed TFUSD contracts on the current network.
 *
 * Reads addresses from deployments/<network>/deploy-addresses.json and calls
 * Hardhat's verify:verify task for each contract.
 *
 * Run: npx hardhat run scripts/verify.js --network <network>
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;
  const deploymentDir = path.join(__dirname, '..', 'deployments', networkName);
  const deploymentFile = path.join(deploymentDir, 'deploy-addresses.json');

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  const { create3Factory, contracts, roles } = deployment;
  const owner = roles.owner;
  const masterMinter = roles.masterMinter;
  const pauser = roles.pauser;
  const blacklister = roles.blacklister;
  const rescuer = roles.rescuer;

  const toVerify = [
    {
      name: 'CREATE3Factory',
      address: create3Factory,
      args: [],
    },
    {
      name: 'TreuhandFinanzgruppeUSD',
      address: contracts.TreuhandFinanzgruppeUSD.address,
      args: [
        contracts.TreuhandFinanzgruppeUSD.name,
        contracts.TreuhandFinanzgruppeUSD.symbol,
        contracts.TreuhandFinanzgruppeUSD.currency,
        masterMinter,
        pauser,
        blacklister,
        rescuer,
        owner,
      ],
    },
    {
      name: 'TreuhandFinanzgruppeUSDDAO',
      address: contracts.TreuhandFinanzgruppeUSDDAO.address,
      args: [contracts.TreuhandFinanzgruppeUSD.address, owner],
    },
  ];

  console.log(`Verifying ${toVerify.length} contracts on ${networkName} (chainId ${network.chainId})...`);

  for (const { name, address, args } of toVerify) {
    try {
      console.log(`\n  Verifying ${name} at ${address}...`);
      await hre.run('verify:verify', {
        address,
        constructorArguments: args,
      });
      console.log(`  ✓ ${name} verified`);
    } catch (err) {
      const msg = err.message || err.toString();
      if (msg.includes('Already Verified') || msg.includes('already verified')) {
        console.log(`  ✓ ${name} already verified`);
      } else {
        console.error(`  ✗ ${name} verification failed: ${msg}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Verification script failed:', err);
    process.exit(1);
  });
