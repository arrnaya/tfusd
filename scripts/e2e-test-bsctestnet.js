/**
 * End-to-end test of TreuhandFinanzgruppeUSD and TreuhandFinanzgruppeUSDDAO on a BSC Testnet fork.
 *
 * This exercises every major business-logic path (minting, burning, pause,
 * blacklist, trade freeze, DEX registry, rescue, DAO proposals, guardian
 * actions, emergency pause/unpause) against the live testnet deployment.
 *
 * Run with forking enabled:
 *   HARDHAT_FORK_ENABLED=true npx hardhat run scripts/e2e-test-bsctestnet.js
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

const DEPLOYMENT_FILE = path.join(__dirname, '..', 'deployments', 'bscTestnet', 'deploy-addresses.json');

const DETERMINISTIC_DEPLOYER_TX =
  '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222';
const DETERMINISTIC_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * ONE_HOUR;
const THREE_DAYS = 3 * ONE_DAY;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

async function advanceTime(seconds) {
  const latest = await ethers.provider.getBlock('latest');
  await ethers.provider.send('evm_setNextBlockTimestamp', [Number(latest.timestamp) + seconds]);
  await ethers.provider.send('evm_mine');
}

async function setBalance(address, wei) {
  await ethers.provider.send('hardhat_setBalance', [address, ethers.toBeHex(wei)]);
}

async function deployFresh(deployer) {
  console.log('  Running on local Hardhat network — deploying fresh contracts for testing...');
  const provider = deployer.provider;

  // Ensure deterministic deployer proxy exists
  if ((await provider.getCode(DETERMINISTIC_DEPLOYER)) === '0x') {
    const sender = ethers.Transaction.from(DETERMINISTIC_DEPLOYER_TX).from;
    await (await deployer.sendTransaction({ to: sender, value: ethers.parseEther('0.02') })).wait();
    await provider.send('eth_sendRawTransaction', [DETERMINISTIC_DEPLOYER_TX]);
    for (let i = 0; i < 10; i++) {
      if ((await provider.getCode(DETERMINISTIC_DEPLOYER)) !== '0x') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const Factory = await ethers.getContractFactory('CREATE3Factory');
  const TreuhandFinanzgruppeUSD = await ethers.getContractFactory('TreuhandFinanzgruppeUSD');
  const TreuhandFinanzgruppeUSDDAO = await ethers.getContractFactory('TreuhandFinanzgruppeUSDDAO');

  const factorySalt = ethers.keccak256(ethers.toUtf8Bytes('TFUSD/CREATE3Factory/v1'));
  const tfusdSalt = ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSD/v1'));
  const daoSalt = ethers.keccak256(ethers.toUtf8Bytes('TreuhandFinanzgruppeUSDDAO/v2'));

  const factoryAddress = ethers.getCreate2Address(
    DETERMINISTIC_DEPLOYER,
    factorySalt,
    ethers.keccak256(Factory.bytecode)
  );

  if ((await provider.getCode(factoryAddress)) === '0x') {
    const factoryData = factorySalt + Factory.bytecode.slice(2);
    await (await deployer.sendTransaction({ to: DETERMINISTIC_DEPLOYER, data: factoryData })).wait();
  }
  const factory = new ethers.Contract(factoryAddress, Factory.interface, deployer);

  const tfusdCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSD.bytecode,
    TreuhandFinanzgruppeUSD.interface.encodeDeploy([
      'Treuhand Finanzgruppe USD', 'TFUSD', 'USD',
      deployer.address, deployer.address, deployer.address, deployer.address, deployer.address,
    ]),
  ]);
  const tfusdAddress = await factory.getDeployed(tfusdSalt);
  if ((await provider.getCode(tfusdAddress)) === '0x') {
    await (await factory.deploy(tfusdSalt, tfusdCreationCode)).wait();
  }

  const daoCreationCode = ethers.concat([
    TreuhandFinanzgruppeUSDDAO.bytecode,
    TreuhandFinanzgruppeUSDDAO.interface.encodeDeploy([tfusdAddress, deployer.address]),
  ]);
  const daoAddress = await factory.getDeployed(daoSalt);
  if ((await provider.getCode(daoAddress)) === '0x') {
    await (await factory.deploy(daoSalt, daoCreationCode)).wait();
  }

  const tfusd = new ethers.Contract(tfusdAddress, TreuhandFinanzgruppeUSD.interface, deployer);
  const dao = new ethers.Contract(daoAddress, TreuhandFinanzgruppeUSDDAO.interface, deployer);

  // Configure DAO as minter and grant all delegated-operation roles
  if (!(await tfusd.isMinter(daoAddress))) {
    await (await tfusd.configureMinter(daoAddress, ethers.parseUnits('1000000000', 18))).wait();
  }
  const roles = [
    await tfusd.PAUSER_ROLE(),
    await tfusd.BLACKLISTER_ROLE(),
    await tfusd.FREEZER_ROLE(),
    await tfusd.DEX_MANAGER_ROLE(),
    await tfusd.MASTERMINTER_ROLE(),
    await tfusd.RESCUER_ROLE(),
  ];
  for (const role of roles) {
    if (!(await tfusd.hasRole(role, daoAddress))) {
      await (await tfusd.grantRole(role, daoAddress)).wait();
    }
  }

  return { tfusdAddress, daoAddress, tfusd, dao };
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  TFUSD / DAO end-to-end test');
  console.log('══════════════════════════════════════════════════════════════════');

  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY env var is required');
  }

  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  if (isLocal) {
    await ethers.provider.send('hardhat_setBalance', [
      deployer.address,
      ethers.toBeHex(ethers.parseEther('100')),
    ]);
  }

  let tfusdAddress, daoAddress;
  if (isLocal) {
    const deployed = await deployFresh(deployer);
    tfusdAddress = deployed.tfusdAddress;
    daoAddress = deployed.daoAddress;
  } else {
    if (!fs.existsSync(DEPLOYMENT_FILE)) {
      throw new Error(`Deployment file not found: ${DEPLOYMENT_FILE}`);
    }
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    tfusdAddress = deployment.contracts.TreuhandFinanzgruppeUSD.address;
    daoAddress = deployment.contracts.TreuhandFinanzgruppeUSDDAO.address;
  }
  const [alice, bob, carol, dave] = (await ethers.getSigners()).slice(1, 5);
  for (const account of [alice, bob, carol, dave]) {
    await setBalance(account.address, ethers.parseEther('1'));
  }

  console.log(`  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  TFUSD:    ${tfusdAddress}`);
  console.log(`  DAO:      ${daoAddress}`);
  console.log(`  Alice:    ${alice.address}`);
  console.log(`  Bob:      ${bob.address}`);
  console.log(`  Carol:    ${carol.address}`);
  console.log(`  Dave:     ${dave.address}`);

  const tfusd = await ethers.getContractAt('TreuhandFinanzgruppeUSD', tfusdAddress, deployer);
  const dao = await ethers.getContractAt('TreuhandFinanzgruppeUSDDAO', daoAddress, deployer);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const expectRevert = async (promise, expectedReason) => {
    try {
      const tx = await promise;
      if (tx.wait) await tx.wait();
      throw new Error(`Expected revert (${expectedReason}) but tx succeeded`);
    } catch (err) {
      const reason = err.reason || err.message || '';
      if (!reason.includes(expectedReason) && !err.code?.includes('REVERT')) {
        throw new Error(`Unexpected revert reason. Expected "${expectedReason}", got "${reason}"`);
      }
    }
  };

  const log = (msg) => console.log(`    ✓ ${msg}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Basic state
  // ═══════════════════════════════════════════════════════════════════════════
  assert((await tfusd.name()) === 'Treuhand Finanzgruppe USD', 'name mismatch');
  assert((await tfusd.symbol()) === 'TFUSD', 'symbol mismatch');
  assert((await tfusd.decimals()) === 18n, 'decimals mismatch');
  assert((await tfusd.owner()) === deployer.address, 'owner mismatch');
  assert((await dao.owner()) === deployer.address, 'DAO owner mismatch');
  log('basic token/DAO state correct');

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Minter management + mint/burn
  // ═══════════════════════════════════════════════════════════════════════════
  await (await tfusd.configureMinter(alice.address, ethers.parseUnits('1000', 18))).wait();
  assert(await tfusd.isMinter(alice.address), 'alice should be minter');

  await (await tfusd.connect(alice).mint(alice.address, ethers.parseUnits('500', 18))).wait();
  assert((await tfusd.balanceOf(alice.address)) === ethers.parseUnits('500', 18), 'alice balance after mint');
  assert(
    (await tfusd.minterAllowanceOf(alice.address)) === ethers.parseUnits('500', 18),
    'alice allowance decreased'
  );
  log('minter mint works');

  await (await tfusd.mintByMaster(alice.address, ethers.parseUnits('1000', 18))).wait();
  assert((await tfusd.balanceOf(alice.address)) === ethers.parseUnits('1500', 18), 'master mint balance');
  log('master mint works');

  await (await tfusd.connect(alice).burn(ethers.parseUnits('200', 18))).wait();
  assert((await tfusd.balanceOf(alice.address)) === ethers.parseUnits('1300', 18), 'burn balance');
  log('burn works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Pause
  // ═══════════════════════════════════════════════════════════════════════════
  await (await tfusd.pause()).wait();
  assert(await tfusd.paused(), 'should be paused');
  await expectRevert(tfusd.mintByMaster(alice.address, 1), 'EnforcedPause');
  await (await tfusd.unpause()).wait();
  assert(!(await tfusd.paused()), 'should be unpaused');
  log('pause/unpause works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Blacklist
  // ═══════════════════════════════════════════════════════════════════════════
  await (await tfusd.addBlacklisted(bob.address)).wait();
  assert(await tfusd.isBlacklisted(bob.address), 'bob blacklisted');
  await expectRevert(tfusd.connect(alice).transfer(bob.address, 1), 'Blacklisted');
  await (await tfusd.removeBlacklisted(bob.address)).wait();
  assert(!(await tfusd.isBlacklisted(bob.address)), 'bob not blacklisted');
  log('blacklist add/remove works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Trade freeze + DEX registry
  // ═══════════════════════════════════════════════════════════════════════════
  const fakeDex = '0x0000000000000000000000000000000000000001';
  await (await tfusd.addDexAddress(fakeDex)).wait();
  assert(await tfusd.isDexAddress(fakeDex), 'dex registered');

  await (await tfusd.addTradeFrozen(bob.address)).wait();
  assert(await tfusd.isTradeFrozen(bob.address), 'bob trade frozen');

  // P2P transfer should still work
  await (await tfusd.connect(alice).transfer(carol.address, ethers.parseUnits('10', 18))).wait();
  assert((await tfusd.balanceOf(carol.address)) === ethers.parseUnits('10', 18), 'P2P transfer to carol');

  // Transfer to DEX should be blocked
  await expectRevert(tfusd.connect(bob).transfer(fakeDex, 1), 'TradeFrozen');

  await (await tfusd.removeTradeFrozen(bob.address)).wait();
  await (await tfusd.removeDexAddress(fakeDex)).wait();
  log('trade freeze + DEX registry works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Rescue stuck native funds
  // ═══════════════════════════════════════════════════════════════════════════
  const rescueAmount = ethers.parseEther('0.05');
  await deployer.sendTransaction({ to: tfusdAddress, value: rescueAmount }).then((t) => t.wait());
  const balanceBefore = await ethers.provider.getBalance(deployer.address);
  await (await tfusd.rescueStuckFunds(ethers.ZeroAddress, deployer.address)).wait();
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  assert(balanceAfter - balanceBefore >= rescueAmount - ethers.parseEther('0.001'), 'rescue native funds');
  log('native rescue works');

  // Remove alice as minter to clean up
  await (await tfusd.removeMinter(alice.address)).wait();
  assert(!(await tfusd.isMinter(alice.address)), 'alice minter removed');

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. DAO governance — add carol as guardian so quorum 2 is reachable
  // ═══════════════════════════════════════════════════════════════════════════
  await (await dao.addGuardian(carol.address)).wait();
  assert(await dao.isGuardian(carol.address), 'carol is guardian');
  assert((await dao.getGuardianCount()) === 2n, 'guardian count 2');
  assert((await dao.params()).guardianQuorum === 2n, 'quorum 2');
  log('DAO guardian management works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. DAO proposal: delegateMint
  // ═══════════════════════════════════════════════════════════════════════════
  const mintAmount = ethers.parseUnits('100', 18);
  const callData = dao.interface.encodeFunctionData('delegateMint', [dave.address, mintAmount]);
  const prop1 = await dao.createProposal('Mint via DAO', 'Mint 100 TFUSD to Dave', callData);
  const prop1Receipt = await prop1.wait();
  const prop1Id = prop1Receipt.logs
    .map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'ProposalCreated')?.args.proposalId;
  assert(prop1Id === 1n, 'proposal 1 id');

  await (await dao.vote(prop1Id, 1)).wait(); // owner for
  await (await dao.connect(carol).vote(prop1Id, 1)).wait(); // carol for

  await advanceTime(THREE_DAYS + ONE_DAY + 1); // voting + timelock
  await (await dao.executeProposal(prop1Id)).wait();
  assert((await tfusd.balanceOf(dave.address)) === mintAmount, 'DAO delegate mint executed');
  log('DAO proposal delegateMint works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. DAO proposal: parameter update
  // ═══════════════════════════════════════════════════════════════════════════
  const callData2 = dao.interface.encodeFunctionData('updateDepegThreshold', [990]);
  const prop2 = await dao.createProposal('Update threshold', 'Set depeg threshold to 990', callData2);
  const prop2Receipt = await prop2.wait();
  const prop2Id = prop2Receipt.logs
    .map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'ProposalCreated')?.args.proposalId;
  await (await dao.vote(prop2Id, 1)).wait();
  await (await dao.connect(carol).vote(prop2Id, 1)).wait();
  await advanceTime(THREE_DAYS + ONE_DAY + 1);
  await (await dao.executeProposal(prop2Id)).wait();
  assert((await dao.params()).depegThreshold === 990n, 'depeg threshold updated');
  log('DAO proposal parameter update works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. DAO proposal: delegateConfigureMinter (requires DAO MASTERMINTER_ROLE)
  // ═══════════════════════════════════════════════════════════════════════════
  const callData3 = dao.interface.encodeFunctionData('delegateConfigureMinter', [bob.address, ethers.parseUnits('1000', 18)]);
  const prop3 = await dao.createProposal('Configure minter', 'Make Bob a minter', callData3);
  const prop3Receipt = await prop3.wait();
  const prop3Id = prop3Receipt.logs
    .map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'ProposalCreated')?.args.proposalId;
  await (await dao.vote(prop3Id, 1)).wait();
  await (await dao.connect(carol).vote(prop3Id, 1)).wait();
  await advanceTime(THREE_DAYS + ONE_DAY + 1);
  await (await dao.executeProposal(prop3Id)).wait();
  assert(await tfusd.isMinter(bob.address), 'bob minter via DAO');
  await (await tfusd.connect(bob).mint(bob.address, ethers.parseUnits('50', 18))).wait();
  assert((await tfusd.balanceOf(bob.address)) === ethers.parseUnits('50', 18), 'bob minted');
  log('DAO delegateConfigureMinter works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. DAO proposal: delegateBlacklist
  // ═══════════════════════════════════════════════════════════════════════════
  const callData4 = dao.interface.encodeFunctionData('delegateBlacklist', [dave.address, true]);
  const prop4 = await dao.createProposal('Blacklist Dave', 'Blacklist Dave via DAO', callData4);
  const prop4Receipt = await prop4.wait();
  const prop4Id = prop4Receipt.logs
    .map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'ProposalCreated')?.args.proposalId;
  await (await dao.vote(prop4Id, 1)).wait();
  await (await dao.connect(carol).vote(prop4Id, 1)).wait();
  await advanceTime(THREE_DAYS + ONE_DAY + 1);
  await (await dao.executeProposal(prop4Id)).wait();
  assert(await tfusd.isBlacklisted(dave.address), 'dave blacklisted via DAO');
  log('DAO delegateBlacklist works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Guardian multi-sig action: delegateTradeFreeze
  // ═══════════════════════════════════════════════════════════════════════════
  const actionCallData = dao.interface.encodeFunctionData('delegateTradeFreeze', [dave.address, true]);
  await (await dao.createGuardianAction(actionCallData, 'tradeFreeze')).wait();
  const action1Id = await dao.guardianActionCount();
  await (await dao.connect(carol).approveGuardianAction(action1Id)).wait(); // carol approves
  await (await dao.executeGuardianAction(action1Id)).wait();
  assert(await tfusd.isTradeFrozen(dave.address), 'dave trade frozen via guardian action');
  log('DAO guardian multi-sig action works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Emergency pause / unpause
  // ═══════════════════════════════════════════════════════════════════════════
  await (await dao.connect(carol).emergencyPause()).wait();
  assert(await tfusd.paused(), 'emergency paused');
  assert(await dao.emergencyPaused(), 'DAO emergency paused flag');

  await advanceTime(ONE_HOUR + 1);
  await (await dao.connect(carol).emergencyUnpause()).wait();
  assert(!(await tfusd.paused()), 'emergency unpaused');
  assert(!(await dao.emergencyPaused()), 'DAO emergency unpaused flag');
  log('DAO emergency pause/unpause works');

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. DAO proposal: delegateRescueStuckFunds
  // ═══════════════════════════════════════════════════════════════════════════
  const rescueAmount2 = ethers.parseEther('0.01');
  await deployer.sendTransaction({ to: tfusdAddress, value: rescueAmount2 }).then((t) => t.wait());
  const daveBalanceBefore = await ethers.provider.getBalance(dave.address);
  const callData5 = dao.interface.encodeFunctionData('delegateRescueStuckFunds', [ethers.ZeroAddress, dave.address]);
  const prop5 = await dao.createProposal('Rescue funds', 'Rescue stuck BNB to Dave', callData5);
  const prop5Receipt = await prop5.wait();
  const prop5Id = prop5Receipt.logs
    .map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
    .find((p) => p?.name === 'ProposalCreated')?.args.proposalId;
  await (await dao.vote(prop5Id, 1)).wait();
  await (await dao.connect(carol).vote(prop5Id, 1)).wait();
  await advanceTime(THREE_DAYS + ONE_DAY + 1);
  await (await dao.executeProposal(prop5Id)).wait();
  const daveBalanceAfter = await ethers.provider.getBalance(dave.address);
  assert(daveBalanceAfter - daveBalanceBefore >= rescueAmount2 - ethers.parseEther('0.001'), 'DAO rescue executed');
  log('DAO delegateRescueStuckFunds works');

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  All end-to-end tests passed ✓');
  console.log('══════════════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nE2E test failed:', err);
    process.exit(1);
  });
