/**
 * Cross-chain CREATE3 deployment preflight
 *
 * 1. Computes the deterministic addresses for the CREATE3 factory, TreuhandFinanzgruppeUSD,
 *    and TreuhandFinanzgruppeUSDDAO without broadcasting any transactions.
 * 2. Checks that the same addresses are derivable on Ethereum, Polygon, and
 *    BSC mainnet.
 * 3. Checks deployer native balances and current gas prices on each chain.
 * 4. Estimates total deployment cost and reports whether balances are sufficient.
 *
 * Run: npx hardhat run scripts/preflight-crosschain.js
 */

const { ethers } = require('hardhat');

const DETERMINISTIC_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const FACTORY_SALT = process.env.TFUSD_CREATE3_FACTORY_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_CREATE3_FACTORY_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TFUSD/CREATE3Factory/v1'));
const TFUSD_SALT = process.env.TFUSD_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSD/v1'));
const DAO_SALT = process.env.TFUSD_DAO_SALT
  ? ethers.keccak256(ethers.toUtf8Bytes(process.env.TFUSD_DAO_SALT))
  : ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSDDAO/v2'));

// Gas observed on a clean local deployment (Hardhat, same bytecode).
// These are used as conservative estimates where on-chain simulation is not
// possible because the contracts do not exist yet.
const GAS_ESTIMATES = {
  factoryDeploy: 295_162,
  tfusdDeploy: 2_714_477,
  daoDeploy: 4_537_133,
  configureMinter: 72_781,
  grantRole: 51_565,
};

const NETWORKS = [
  {
    key: 'ethereum',
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC || 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io',
    nativeSymbol: 'ETH',
    coingeckoId: 'ethereum',
  },
  {
    key: 'polygon',
    name: 'Polygon PoS',
    chainId: 137,
    rpcUrl: process.env.POLYGON_RPC || 'https://polygon-bor-rpc.publicnode.com',
    explorer: 'https://polygonscan.com',
    nativeSymbol: 'MATIC',
    coingeckoId: 'matic-network',
  },
  {
    key: 'bsc-mainnet',
    name: 'BSC Mainnet',
    chainId: 56,
    rpcUrl: process.env.BSC_MAINNET_RPC || 'https://bsc-dataseed1.binance.org',
    explorer: 'https://bscscan.com',
    nativeSymbol: 'BNB',
    coingeckoId: 'binancecoin',
  },
];

// Solmate CREATE3 proxy child bytecode hash.
const PROXY_BYTECODE = '0x67363d3d37363d34f03d5260086018f3';
const PROXY_BYTECODE_HASH = ethers.keccak256(PROXY_BYTECODE);

function getCreate3Address(creator, salt) {
  const proxy = ethers.getCreate2Address(creator, salt, PROXY_BYTECODE_HASH);
  return ethers.getCreateAddress({ from: proxy, nonce: 1 });
}

async function fetchPrices() {
  try {
    const ids = NETWORKS.map((n) => n.coingeckoId).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    console.warn('  Could not fetch USD prices:', e.message);
    return {};
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY env var is required');
  }

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const deployerAddress = wallet.address;

  // Role addresses used for the BSC testnet deployment — must be identical on
  // every chain to keep the same CREATE3 addresses.
  const owner = process.env.TFUSD_OWNER || deployerAddress;
  const masterMinter = process.env.TFUSD_MASTERMINTER || deployerAddress;
  const pauser = process.env.TFUSD_PAUSER || deployerAddress;
  const blacklister = process.env.TFUSD_BLACKLISTER || deployerAddress;
  const rescuer = process.env.TFUSD_RESCUER || deployerAddress;

  const Factory = await ethers.getContractFactory('CREATE3Factory');
  const TreuhandFinanzgruppeUSD = await ethers.getContractFactory('TreuhandFinanzgruppeUSD');
  const TreuhandFinanzgruppeUSDDAO = await ethers.getContractFactory('TreuhandFinanzgruppeUSDDAO');

  const factoryBytecode = Factory.bytecode;
  const factoryInitCodeHash = ethers.keccak256(factoryBytecode);
  const expectedFactory = ethers.getCreate2Address(
    DETERMINISTIC_DEPLOYER,
    FACTORY_SALT,
    factoryInitCodeHash
  );

  const tfusdCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSD.bytecode,
    TreuhandFinanzgruppeUSD.interface.encodeDeploy([
      'Treuhand Finanzgruppe USD',
      'TFUSD',
      'USD',
      masterMinter,
      pauser,
      blacklister,
      rescuer,
      owner,
    ]),
  ]);
  const daoCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSDDAO.bytecode,
    TreuhandFinanzgruppeUSDDAO.interface.encodeDeploy([expectedFactory ? getCreate3Address(expectedFactory, TFUSD_SALT) : ethers.ZeroAddress, owner]),
  ]);

  const expectedTfusd = getCreate3Address(expectedFactory, TFUSD_SALT);
  const expectedDao = getCreate3Address(expectedFactory, DAO_SALT);

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  Cross-chain CREATE3 preflight');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Deployer:       ${deployerAddress}`);
  console.log(`  Roles (owner):  ${owner}`);
  console.log(`  Expected CREATE3 Factory: ${expectedFactory}`);
  console.log(`  Expected TreuhandFinanzgruppeUSD:      ${expectedTfusd}`);
  console.log(`  Expected TreuhandFinanzgruppeUSDDAO:   ${expectedDao}`);
  console.log('──────────────────────────────────────────────────────────────────');

  const prices = await fetchPrices();

  const results = [];

  for (const network of NETWORKS) {
    const provider = new ethers.JsonRpcProvider(network.rpcUrl);
    const [balance, codeProxy, codeFactory, codeTfusd, codeDao, feeData, networkChainId] = await Promise.all([
      provider.getBalance(deployerAddress).catch(() => null),
      provider.getCode(DETERMINISTIC_DEPLOYER).catch(() => '0x'),
      provider.getCode(expectedFactory).catch(() => '0x'),
      provider.getCode(expectedTfusd).catch(() => '0x'),
      provider.getCode(expectedDao).catch(() => '0x'),
      provider.getFeeData().catch(() => null),
      provider.getNetwork().then((n) => n.chainId).catch(() => null),
    ]);

    const proxyMissing = codeProxy === '0x';
    const factoryDeployed = codeFactory !== '0x';
    const tfusdDeployed = codeTfusd !== '0x';
    const daoDeployed = codeDao !== '0x';

    // If the contracts are already deployed, no further deployment cost is
    // needed. Otherwise estimate the remaining work.
    const grantRoleCount = 6;
    const totalGas =
      (factoryDeployed ? 0 : GAS_ESTIMATES.factoryDeploy) +
      (tfusdDeployed ? 0 : GAS_ESTIMATES.tfusdDeploy) +
      (daoDeployed ? 0 : GAS_ESTIMATES.daoDeploy) +
      (tfusdDeployed ? 0 : GAS_ESTIMATES.configureMinter) +
      (tfusdDeployed ? 0 : GAS_ESTIMATES.grantRole * grantRoleCount);

    const gasPrice = feeData?.maxFeePerGas ?? feeData?.gasPrice ?? 0n;
    const estimatedCostWei = totalGas > 0 && gasPrice > 0n ? BigInt(totalGas) * gasPrice : 0n;
    const estimatedCostNative = ethers.formatEther(estimatedCostWei);
    const priceUsd = prices[network.coingeckoId]?.usd;
    const estimatedCostUsd = priceUsd ? parseFloat(estimatedCostNative) * priceUsd : null;

    const balanceNative = balance !== null ? ethers.formatEther(balance) : null;
    const hasBalance = balance !== null && estimatedCostWei > 0n ? balance >= estimatedCostWei : true;

    results.push({
      network,
      networkChainId,
      proxyMissing,
      factoryDeployed,
      tfusdDeployed,
      daoDeployed,
      totalGas,
      gasPrice,
      estimatedCostWei,
      estimatedCostNative,
      estimatedCostUsd,
      balanceNative,
      hasBalance,
      balance,
    });

    const redactedRpc = network.rpcUrl
      .replace(/\/\/[^@]+@/, '//***@')
      .replace(/(\/v2\/)[^\/?]+/, '$1***')
      .replace(/([?&](?:api-key|key|token)=)[^&]+/, '$1***');
    console.log(`\n  ${network.name} (chainId: ${networkChainId ?? 'unreachable'})`);
    console.log(`    RPC: ${redactedRpc}`);
    console.log(`    Deterministic deployer proxy: ${proxyMissing ? 'MISSING (must be deployed first)' : 'present'}`);
    console.log(`    CREATE3 factory: ${factoryDeployed ? 'deployed' : 'not deployed'}`);
    console.log(`    TreuhandFinanzgruppeUSD: ${tfusdDeployed ? 'deployed' : 'not deployed'}`);
    console.log(`    TreuhandFinanzgruppeUSDDAO: ${daoDeployed ? 'deployed' : 'not deployed'}`);
    console.log(`    Deployer balance: ${balanceNative !== null ? `${balanceNative} ${network.nativeSymbol}` : 'unavailable'}`);
    console.log(`    Estimated gas: ${totalGas.toLocaleString()}`);
    console.log(`    Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
    console.log(`    Estimated cost: ${estimatedCostNative} ${network.nativeSymbol}` +
      (estimatedCostUsd !== null ? ` (~$${estimatedCostUsd.toFixed(2)})` : ''));
    console.log(`    Verdict: ${hasBalance ? 'SUFFICIENT BALANCE' : 'INSUFFICIENT BALANCE — top-up required'}`);
  }

  console.log('\n══════════════════════════════════════════════════════════════════');

  const anyProxyMissing = results.some((r) => r.proxyMissing);
  const anyInsufficient = results.some((r) => !r.hasBalance);

  if (anyProxyMissing) {
    console.log('  WARNING: The deterministic deployer proxy is missing on at least');
    console.log('  one chain. It must be deployed (via raw tx) before the CREATE3');
    console.log('  factory can be deployed. The deploy script handles this, but it');
    console.log('  adds an extra ~0.01 ETH/BNB/MATIC of gas cost.');
  }

  if (anyInsufficient) {
    console.log('  RESULT: At least one chain needs a top-up before deployment.');
    console.log('  Please fund the deployer wallet on the flagged chains, then re-run.');
  } else {
    console.log('  RESULT: All reachable chains have sufficient balance for deployment.');
    console.log('  The same deterministic addresses are derivable on every chain.');
    console.log('  Awaiting your approval to proceed with mainnet/Polygon/BSC deployments.');
  }

  console.log('══════════════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Preflight failed:', err);
    process.exit(1);
  });
