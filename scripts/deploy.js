/**
 * =============================================================================
 * Treuhand Finanzgruppe USD (TFUSD) CREATE3 Deployment Script
 * =============================================================================
 * Deploys TreuhandFinanzgruppeUSD.sol and TreuhandFinanzgruppeUSDDAO.sol using CREATE3 so that the same
 * contract addresses are produced on every EVM chain.
 *
 * How it works:
 * 1. Uses the widely-deployed deterministic deployment proxy
 *    (0x4e59b44847b379578588920ca78fbf26c0b4956c) to deploy a CREATE3Factory
 *    via CREATE2. This address depends only on the proxy address, a fixed salt,
 *    and the factory bytecode — NOT on the deployer's nonce.
 * 2. Uses the CREATE3Factory to deploy TreuhandFinanzgruppeUSD and TreuhandFinanzgruppeUSDDAO. CREATE3
 *    addresses depend only on the factory address and a salt.
 *
 * Requirements:
 * - The deployer account must have enough gas on each chain.
 * - The deterministic deployment proxy must exist on the target chain. It is
 *   already present on Ethereum, BSC, Polygon, and most major EVM chains. If it
 *   is missing, the script can broadcast the well-known raw deployment tx.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network bscTestnet
 * =============================================================================
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// Deterministic deployment proxy (Arachnid / EIP-2470)
const DETERMINISTIC_DEPLOYER_ADDRESS = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
const DETERMINISTIC_DEPLOYER_TX =
  '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222';

// The deterministic deployment proxy is a raw Yul contract, not a Solidity ABI
// contract. Its input is simply the 32-byte salt followed by the init code bytes.
function encodeProxyData(salt, initCode) {
  if (!salt.startsWith('0x') || salt.length !== 66) {
    throw new Error('Invalid salt — must be a 32-byte hex string');
  }
  if (!initCode.startsWith('0x')) {
    throw new Error('Invalid initCode — must be a hex string');
  }
  return salt + initCode.slice(2);
}

// Stable CREATE2/CREATE3 salts. These determine the final addresses.
const FACTORY_SALT = process.env.TFUSD_CREATE3_FACTORY_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_CREATE3_FACTORY_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TFUSD/CREATE3Factory/v1'));
const TFUSD_SALT = process.env.TFUSD_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSD/v1'));
const TFUSD_DAO_SALT = process.env.TFUSD_DAO_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_DAO_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSDDAO/v2'));

async function ensureDeterministicDeployer(deployer) {
  const provider = deployer.provider;
  const code = await provider.getCode(DETERMINISTIC_DEPLOYER_ADDRESS);
  if (code !== '0x') return;

  const deployerSender = ethers.Transaction.from(DETERMINISTIC_DEPLOYER_TX).from;
  console.log(`  Deterministic deployer not present — funding sender ${deployerSender}`);
  const gasCost = ethers.toBigInt('0x174876e800') * ethers.toBigInt('0x186a0'); // gasPrice * gasLimit
  const fundTx = await deployer.sendTransaction({
    to: deployerSender,
    value: gasCost + ethers.parseEther('0.01'),
  });
  await fundTx.wait();

  console.log('  Broadcasting raw deployment tx...');
  const txHash = await provider.send('eth_sendRawTransaction', [DETERMINISTIC_DEPLOYER_TX]);
  let receipt = null;
  for (let i = 0; i < 30; i++) {
    receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!receipt || !receipt.contractAddress) {
    throw new Error('Deterministic deployer deployment failed');
  }
  console.log(`  Deterministic deployer deployed: ${receipt.contractAddress}`);

  // Give load-balanced RPCs a moment to propagate the new state.
  for (let i = 0; i < 10; i++) {
    if ((await provider.getCode(DETERMINISTIC_DEPLOYER_ADDRESS)) !== '0x') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Deterministic deployer not visible after deployment');
}

async function ensureCreate3Factory(deployer) {
  const provider = deployer.provider;
  await ensureDeterministicDeployer(deployer);

  const Factory = await ethers.getContractFactory('CREATE3Factory');
  const factoryBytecode = Factory.bytecode;
  const factoryInitCodeHash = ethers.keccak256(factoryBytecode);
  const expectedFactoryAddress = ethers.getCreate2Address(
    DETERMINISTIC_DEPLOYER_ADDRESS,
    FACTORY_SALT,
    factoryInitCodeHash
  );
  console.log(`  Expected CREATE3 factory: ${expectedFactoryAddress}`);

  const code = await provider.getCode(expectedFactoryAddress);
  if (code !== '0x') {
    console.log('  CREATE3 factory already deployed — reusing');
  } else {
    console.log('  Deploying CREATE3 factory via deterministic deployer...');
    const factoryData = encodeProxyData(FACTORY_SALT, factoryBytecode);
    const tx = await deployer.sendTransaction({
      to: DETERMINISTIC_DEPLOYER_ADDRESS,
      data: factoryData,
    });
    const receipt = await tx.wait();
    console.log(`  Factory deploy tx status: ${receipt.status}, gasUsed: ${receipt.gasUsed.toString()}`);

    // Allow a short propagation window for remote RPCs before declaring failure.
    let deployedCode = '0x';
    for (let i = 0; i < 10; i++) {
      deployedCode = await provider.getCode(expectedFactoryAddress);
      if (deployedCode !== '0x') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (deployedCode === '0x') {
      throw new Error(`CREATE3 factory was not deployed at expected address ${expectedFactoryAddress}`);
    }
    console.log(`  CREATE3 factory deployed: ${expectedFactoryAddress}`);
  }

  return { factory: await ethers.getContractAt('CREATE3Factory', expectedFactoryAddress, deployer), expectedFactoryAddress };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;

  // Role addresses — on public networks all roles default to the deployer.
  const masterMinter = process.env.TFUSD_MASTERMINTER || deployer.address;
  const pauser = process.env.TFUSD_PAUSER || deployer.address;
  const blacklister = process.env.TFUSD_BLACKLISTER || deployer.address;
  const rescuer = process.env.TFUSD_RESCUER || deployer.address;
  const owner = process.env.TFUSD_OWNER || deployer.address;

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Treuhand Finanzgruppe USD (TFUSD) CREATE3 Deployment');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Network:      ${networkName} (chainId: ${network.chainId})`);
  console.log(`  Deployer:     ${deployer.address}`);
  console.log(`  Owner:        ${owner}`);
  console.log(`  MasterMinter: ${masterMinter}`);
  console.log(`  Pauser:       ${pauser}`);
  console.log(`  Blacklister:  ${blacklister}`);
  console.log(`  Rescuer:      ${rescuer}`);
  console.log('──────────────────────────────────────────────────────────────────');

  // ── Deploy / locate CREATE3 factory ────────────────────────────────────────
  const { factory, expectedFactoryAddress } = await ensureCreate3Factory(deployer);

  // ── Prepare TreuhandFinanzgruppeUSD creation code ───────────────────────────────────────
  const TreuhandFinanzgruppeUSD = await ethers.getContractFactory('TreuhandFinanzgruppeUSD');
  const tfusdCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSD.bytecode,
    TreuhandFinanzgruppeUSD.interface.encodeDeploy(['Treuhand Finanzgruppe USD', 'TFUSD', 'USD', masterMinter, pauser, blacklister, rescuer, owner]),
  ]);

  // ── Deploy TreuhandFinanzgruppeUSD via CREATE3 ──────────────────────────────────────────
  let tfusdAddress = await factory.getDeployed(TFUSD_SALT);
  const existingTfusdCode = await ethers.provider.getCode(tfusdAddress);

  if (existingTfusdCode !== '0x') {
    console.log(`  TreuhandFinanzgruppeUSD already deployed: ${tfusdAddress}`);
  } else {
    const tx = await factory.deploy(TFUSD_SALT, tfusdCreationCode);
    const receipt = await tx.wait();
    console.log(`    TreuhandFinanzgruppeUSD deploy gas used: ${receipt.gasUsed.toString()}`);
    const deployedEvent = receipt.logs
      .map((log) => factory.interface.parseLog(log))
      .find((parsed) => parsed && parsed.name === 'Deployed' && parsed.args.salt === TFUSD_SALT);
    tfusdAddress = deployedEvent ? deployedEvent.args.deployed : tfusdAddress;
    console.log(`  TreuhandFinanzgruppeUSD deployed:   ${tfusdAddress}`);
  }

  // ── Prepare TreuhandFinanzgruppeUSDDAO creation code ────────────────────────────────────
  const TreuhandFinanzgruppeUSDDAO = await ethers.getContractFactory('TreuhandFinanzgruppeUSDDAO');
  const daoCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSDDAO.bytecode,
    TreuhandFinanzgruppeUSDDAO.interface.encodeDeploy([tfusdAddress, owner]),
  ]);

  // ── Deploy TreuhandFinanzgruppeUSDDAO via CREATE3 ───────────────────────────────────────
  let daoAddress = await factory.getDeployed(TFUSD_DAO_SALT);
  const existingDaoCode = await ethers.provider.getCode(daoAddress);

  if (existingDaoCode !== '0x') {
    console.log(`  TreuhandFinanzgruppeUSDDAO already deployed: ${daoAddress}`);
  } else {
    const tx = await factory.deploy(TFUSD_DAO_SALT, daoCreationCode);
    const receipt = await tx.wait();
    console.log(`    TreuhandFinanzgruppeUSDDAO deploy gas used: ${receipt.gasUsed.toString()}`);
    const deployedEvent = receipt.logs
      .map((log) => factory.interface.parseLog(log))
      .find((parsed) => parsed && parsed.name === 'Deployed' && parsed.args.salt === TFUSD_DAO_SALT);
    daoAddress = deployedEvent ? deployedEvent.args.deployed : daoAddress;
    console.log(`  TreuhandFinanzgruppeUSDDAO deployed: ${daoAddress}`);
  }

  // ── Configure DAO as Minter on TreuhandFinanzgruppeUSD ──────────────────────────────────
  const tfusd = await ethers.getContractAt('TreuhandFinanzgruppeUSD', tfusdAddress, deployer);
  const daoAllowance = ethers.parseUnits('1000000000', 18); // 1B TFUSD

  const isMinter = await tfusd.isMinter(daoAddress);
  if (!isMinter) {
    const tx = await tfusd.connect(deployer).configureMinter(daoAddress, daoAllowance);
    const minterReceipt = await tx.wait();
    console.log(`  DAO configured as minter (allowance: ${ethers.formatUnits(daoAllowance, 18)} TFUSD, gas: ${minterReceipt.gasUsed.toString()})`);
  } else {
    console.log('  DAO already configured as minter');
  }

  // ── Grant DAO operational roles on TreuhandFinanzgruppeUSD ──────────────────────────────
  const PAUSER_ROLE = await tfusd.PAUSER_ROLE();
  const BLACKLISTER_ROLE = await tfusd.BLACKLISTER_ROLE();
  const FREEZER_ROLE = await tfusd.FREEZER_ROLE();
  const DEX_MANAGER_ROLE = await tfusd.DEX_MANAGER_ROLE();
  const MASTERMINTER_ROLE = await tfusd.MASTERMINTER_ROLE();
  const RESCUER_ROLE = await tfusd.RESCUER_ROLE();

  const grantRoleIfNeeded = async (role, account) => {
    const hasRole = await tfusd.hasRole(role, account);
    if (!hasRole) {
      await (await tfusd.connect(deployer).grantRole(role, account)).wait();
    }
  };

  const roleGas = [];
  const grantAndLog = async (role, account) => {
    const hasRole = await tfusd.hasRole(role, account);
    if (!hasRole) {
      const tx = await tfusd.connect(deployer).grantRole(role, account);
      const receipt = await tx.wait();
      roleGas.push(receipt.gasUsed.toString());
    }
  };
  await grantAndLog(PAUSER_ROLE, daoAddress);
  await grantAndLog(BLACKLISTER_ROLE, daoAddress);
  await grantAndLog(FREEZER_ROLE, daoAddress);
  await grantAndLog(DEX_MANAGER_ROLE, daoAddress);
  await grantAndLog(MASTERMINTER_ROLE, daoAddress);
  await grantAndLog(RESCUER_ROLE, daoAddress);
  console.log(`  DAO granted PAUSER, BLACKLISTER, FREEZER, DEX_MANAGER, MASTERMINTER, RESCUER roles (gas: ${roleGas.join(', ')})`);

  // Verify
  const allowance = await tfusd.minterAllowanceOf(daoAddress);
  console.log(`  Verification: isMinter=${await tfusd.isMinter(daoAddress)}, allowance=${ethers.formatUnits(allowance, 18)}`);

  // ── Save deployment metadata ───────────────────────────────────────────────
  const deploymentData = {
    network: networkName,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    create3Factory: expectedFactoryAddress,
    salts: {
      create3Factory: FACTORY_SALT,
      TreuhandFinanzgruppeUSD: TFUSD_SALT,
      TreuhandFinanzgruppeUSDDAO: TFUSD_DAO_SALT,
    },
    contracts: {
      TreuhandFinanzgruppeUSD: {
        address: tfusdAddress,
        name: 'Treuhand Finanzgruppe USD',
        symbol: 'TFUSD',
        currency: 'USD',
      },
      TreuhandFinanzgruppeUSDDAO: {
        address: daoAddress,
        owner,
      },
    },
    roles: {
      owner,
      masterMinter,
      pauser,
      blacklister,
      rescuer,
    },
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments', networkName);
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const outPath = path.join(deploymentsDir, 'deploy-addresses.json');
  fs.writeFileSync(outPath, JSON.stringify(deploymentData, null, 2));

  // Also write a flat .env-friendly file
  const envPath = path.join(deploymentsDir, 'contracts.env');
  fs.writeFileSync(
    envPath,
    `TFUSD_CONTRACT_ADDRESS=${tfusdAddress}\nTFUSD_DAO_ADDRESS=${daoAddress}\nCREATE3_FACTORY=${expectedFactoryAddress}\n`
  );

  console.log('──────────────────────────────────────────────────────────────────');
  console.log(`  Addresses saved to: ${outPath}`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Deployment complete ✓');
  console.log('══════════════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
  });
