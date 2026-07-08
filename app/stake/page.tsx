'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import Header from '@/components/Header';
import ConnectWallet from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletContext';
import WalletGate from '@/components/WalletGate';
import { useNetwork } from '@/components/NetworkContext';
import KYCModal from '@/components/KYCModal';
import { TREASURY_ABI } from '@/lib/treasury-abi';
import { TFUSD_ABI } from '@/lib/contract-abi';
import { getTreasuryConfig, parseUnits, formatUnits } from '@/lib/treasury-config';

interface FixedPool {
  poolId: number;
  lockDuration: bigint;
  apy: bigint;
  active: boolean;
}

interface FixedStake {
  index: number;
  amount: bigint;
  startTime: bigint;
  poolId: number;
  claimed: boolean;
  maturity: bigint;
  reward: bigint;
}

export default function StakePage() {
  const { signer, address, isConnected, ethersProvider } = useWallet();
  const { networkConfig, networkKey, setNetwork } = useNetwork();

  useEffect(() => {
    if (networkKey !== 'bsc-mainnet' && networkKey !== 'bsc-testnet') {
      setNetwork('bsc-testnet');
    }
  }, [networkKey, setNetwork]);

  const treasuryConfig = useMemo(() => getTreasuryConfig(networkConfig.key as any), [networkConfig.key]);
  const isTreasuryDeployed = useMemo(
    () => treasuryConfig.treasuryAddress !== '0x0000000000000000000000000000000000000000',
    [treasuryConfig.treasuryAddress]
  );

  const [tfusdBalance, setTfusdBalance] = useState<bigint>(0n);
  const [tfusdAllowance, setTfusdAllowance] = useState<bigint>(0n);
  const [kycThreshold, setKycThreshold] = useState<bigint>(0n);
  const [isKYCPassed, setIsKYCPassed] = useState(false);
  const [flexibleStake, setFlexibleStake] = useState<bigint>(0n);
  const [flexibleRewards, setFlexibleRewards] = useState<bigint>(0n);
  const [pools, setPools] = useState<FixedPool[]>([]);
  const [fixedStakes, setFixedStakes] = useState<FixedStake[]>([]);

  const [flexAmount, setFlexAmount] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);
  const [fixedAmount, setFixedAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showKYC, setShowKYC] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const treasury = useMemo(() => {
    if (!ethersProvider) return null;
    return new ethers.Contract(treasuryConfig.treasuryAddress, TREASURY_ABI, ethersProvider);
  }, [ethersProvider, treasuryConfig.treasuryAddress]);

  const tfusd = useMemo(() => {
    if (!ethersProvider) return null;
    return new ethers.Contract(treasuryConfig.tfusdAddress, TFUSD_ABI, ethersProvider);
  }, [ethersProvider, treasuryConfig.tfusdAddress]);

  const fetchState = useCallback(async () => {
    if (!address || !treasury || !tfusd) return;
    try {
      const [tb, al, thr, kyc, fStake, fRewards, poolCount] = await Promise.all([
        tfusd.balanceOf(address),
        tfusd.allowance(address, treasuryConfig.treasuryAddress),
        treasury.kycThreshold(),
        treasury.isKYCPassed(address),
        treasury.flexibleStake(address),
        treasury.pendingFlexibleRewards(address),
        treasury.nextFixedPoolId(),
      ]);
      setTfusdBalance(tb);
      setTfusdAllowance(al);
      setKycThreshold(thr);
      setIsKYCPassed(kyc);
      setFlexibleStake(fStake);
      setFlexibleRewards(fRewards);

      const poolPromises: Promise<FixedPool>[] = [];
      for (let i = 0; i < Number(poolCount); i++) {
        poolPromises.push(
          treasury.fixedPools(i).then((p: any) => ({
            poolId: i,
            lockDuration: p.lockDuration,
            apy: p.apy,
            active: p.active,
          }))
        );
      }
      const loadedPools = await Promise.all(poolPromises);
      setPools(loadedPools.filter((p) => p.active));

      const count = await treasury.fixedStakeCount(address);
      const stakePromises: Promise<FixedStake>[] = [];
      for (let i = 0; i < Number(count); i++) {
        stakePromises.push(
          treasury.fixedStakeAt(address, i).then((s: any) => {
            const pool = loadedPools.find((p) => p.poolId === Number(s.poolId));
            const maturity = pool ? s.startTime + pool.lockDuration : s.startTime;
            const reward = pool ? fixedReward(s.amount, pool.apy, pool.lockDuration) : 0n;
            return {
              index: i,
              amount: s.amount,
              startTime: s.startTime,
              poolId: Number(s.poolId),
              claimed: s.claimed,
              maturity,
              reward,
            };
          })
        );
      }
      setFixedStakes(await Promise.all(stakePromises));
    } catch (e: any) {
      console.error('fetchState error', e);
    }
  }, [address, treasury, tfusd, treasuryConfig.treasuryAddress]);

  useEffect(() => {
    fetchState();
  }, [fetchState, address, isConnected]);

  const parsedFlexAmount = useMemo(() => {
    try {
      if (!flexAmount || isNaN(Number(flexAmount))) return 0n;
      return parseUnits(flexAmount, 18);
    } catch {
      return 0n;
    }
  }, [flexAmount]);

  const parsedFixedAmount = useMemo(() => {
    try {
      if (!fixedAmount || isNaN(Number(fixedAmount))) return 0n;
      return parseUnits(fixedAmount, 18);
    } catch {
      return 0n;
    }
  }, [fixedAmount]);

  const flexNeedsApprove = parsedFlexAmount > 0n && tfusdAllowance < parsedFlexAmount;
  const fixedNeedsApprove = parsedFixedAmount > 0n && tfusdAllowance < parsedFixedAmount;

  function fixedReward(amount: bigint, apy: bigint, lockDuration: bigint): bigint {
    // reward = amount * apy * lockDuration / (365 days * 10000)
    return (amount * apy * lockDuration) / (BigInt(365 * 24 * 60 * 60) * 10000n);
  }

  function formatDuration(seconds: bigint): string {
    const days = Number(seconds) / 86400;
    if (days >= 365) return `${(days / 365).toFixed(1)}y`;
    if (days >= 30) return `${(days / 30).toFixed(0)}m`;
    return `${Math.round(days)}d`;
  }

  const ensureKYC = (amount: bigint, currentStake: bigint, action: () => Promise<void>): boolean => {
    if (kycThreshold === 0n) return true;
    if (amount + currentStake > kycThreshold && !isKYCPassed) {
      setPendingAction(() => action);
      setShowKYC(true);
      return false;
    }
    return true;
  };

  const approveTfusd = async (amount: bigint) => {
    if (!signer || !tfusd || amount === 0n) return;
    setLoading(true);
    setStatus('Approving TFUSD...');
    try {
      const tx = await (tfusd.connect(signer) as ethers.Contract).approve(treasuryConfig.treasuryAddress, amount);
      await tx.wait();
      setStatus('TFUSD approved.');
      await fetchState();
    } catch (e: any) {
      setStatus(`Approval failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStakeFlexible = async () => {
    if (!signer || !treasury || parsedFlexAmount === 0n) return;
    if (!ensureKYC(parsedFlexAmount, flexibleStake, handleStakeFlexible)) return;
    if (flexNeedsApprove) {
      await approveTfusd(parsedFlexAmount);
      return;
    }
    setLoading(true);
    setStatus('Staking flexibly...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).stakeFlexible(parsedFlexAmount);
      await tx.wait();
      setStatus('Flexible stake confirmed.');
      setFlexAmount('');
      await fetchState();
    } catch (e: any) {
      setStatus(`Stake failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstakeFlexible = async () => {
    if (!signer || !treasury || flexibleStake === 0n) return;
    setLoading(true);
    setStatus('Unstaking flexible position...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).unstakeFlexible();
      await tx.wait();
      setStatus('Unstaked successfully.');
      await fetchState();
    } catch (e: any) {
      setStatus(`Unstake failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimFlexible = async () => {
    if (!signer || !treasury || flexibleRewards === 0n) return;
    setLoading(true);
    setStatus('Claiming rewards...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).claimFlexibleRewards();
      await tx.wait();
      setStatus('Rewards claimed.');
      await fetchState();
    } catch (e: any) {
      setStatus(`Claim failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStakeFixed = async () => {
    if (!signer || !treasury || parsedFixedAmount === 0n || selectedPoolId === null) return;
    if (!ensureKYC(parsedFixedAmount, 0n, handleStakeFixed)) return;
    if (fixedNeedsApprove) {
      await approveTfusd(parsedFixedAmount);
      return;
    }
    setLoading(true);
    setStatus('Staking in fixed pool...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).stakeFixed(selectedPoolId, parsedFixedAmount);
      await tx.wait();
      setStatus('Fixed stake confirmed.');
      setFixedAmount('');
      await fetchState();
    } catch (e: any) {
      setStatus(`Stake failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnstakeFixed = async (index: number) => {
    if (!signer || !treasury) return;
    setLoading(true);
    setStatus('Unstaking fixed position...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).unstakeFixed(index);
      await tx.wait();
      setStatus('Fixed unstake confirmed.');
      await fetchState();
    } catch (e: any) {
      setStatus(`Unstake failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <WalletGate>
      <div style={page}>
        <Header />
      <main style={container}>
        <div style={card}>
          <div style={headerRow}>
            <h1 style={heading}>Stake TFUSD</h1>
            <ConnectWallet />
          </div>
          <p style={sub}>Earn rewards by staking your TFUSD.</p>

          {isConnected && !isTreasuryDeployed && (
            <div style={warning}>Treasury is not deployed on {networkConfig.name}. Switch to BSC Testnet.</div>
          )}

          <div style={balances}>
            <div style={balanceItem}>
              <span style={muted}>TFUSD Balance</span>
              <strong>{formatUnits(tfusdBalance, 18)} TFUSD</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>Flexible Staked</span>
              <strong>{formatUnits(flexibleStake, 18)} TFUSD</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>Pending Rewards</span>
              <strong>{formatUnits(flexibleRewards, 18)} TFUSD</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>KYC Status</span>
              <strong style={{ color: isKYCPassed ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                {isKYCPassed ? 'Verified' : 'Not Verified'}
              </strong>
            </div>
          </div>

          <section style={section}>
            <h2 style={sectionTitle}>Flexible Staking</h2>
            <input
              type="number"
              value={flexAmount}
              onChange={(e) => setFlexAmount(e.target.value)}
              placeholder="Amount to stake"
              style={input}
              min="0"
              step="0.01"
            />
            <button
              onClick={handleStakeFlexible}
              disabled={loading || !isConnected || parsedFlexAmount === 0n || !isTreasuryDeployed}
              style={{ ...primaryBtn, opacity: loading || !isConnected || parsedFlexAmount === 0n ? 0.6 : 1 }}
            >
              {loading ? 'Processing...' : flexNeedsApprove ? 'Approve & Stake' : 'Stake Flexible'}
            </button>
            <div style={row}>
              <button onClick={handleClaimFlexible} disabled={loading || flexibleRewards === 0n} style={secondaryBtn}>
                Claim Rewards
              </button>
              <button onClick={handleUnstakeFlexible} disabled={loading || flexibleStake === 0n} style={secondaryBtn}>
                Unstake All
              </button>
            </div>
          </section>

          <section style={section}>
            <h2 style={sectionTitle}>Fixed Staking Pools</h2>
            {pools.length === 0 && <div style={muted}>No active fixed pools.</div>}
            <select
              value={selectedPoolId ?? ''}
              onChange={(e) => setSelectedPoolId(e.target.value ? Number(e.target.value) : null)}
              style={input}
            >
              <option value="">Select a pool</option>
              {pools.map((p) => (
                <option key={p.poolId} value={p.poolId}>
                  Lock {formatDuration(p.lockDuration)} — {(Number(p.apy) / 100).toFixed(2)}% APY
                </option>
              ))}
            </select>
            <input
              type="number"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value)}
              placeholder="Amount to stake"
              style={input}
              min="0"
              step="0.01"
            />
            <button
              onClick={handleStakeFixed}
              disabled={loading || !isConnected || parsedFixedAmount === 0n || selectedPoolId === null || !isTreasuryDeployed}
              style={{ ...primaryBtn, opacity: loading || !isConnected || parsedFixedAmount === 0n || selectedPoolId === null ? 0.6 : 1 }}
            >
              {loading ? 'Processing...' : fixedNeedsApprove ? 'Approve & Stake' : 'Stake Fixed'}
            </button>

            {fixedStakes.length > 0 && (
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {fixedStakes.map((s) => {
                  const matured = BigInt(Math.floor(Date.now() / 1000)) >= s.maturity;
                  const pool = pools.find((p) => p.poolId === s.poolId);
                  return (
                    <div key={s.index} style={stakeCard}>
                      <div style={stakeRow}>
                        <span style={muted}>Pool {s.poolId}</span>
                        <span style={{ color: matured ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {matured ? 'Matured' : 'Locked'}
                        </span>
                      </div>
                      <div style={stakeRow}>
                        <strong>{formatUnits(s.amount, 18)} TFUSD</strong>
                        <span style={muted}>Reward ~{formatUnits(s.reward, 18)} TFUSD</span>
                      </div>
                      <div style={stakeRow}>
                        <span style={muted}>Matures {new Date(Number(s.maturity) * 1000).toLocaleDateString()}</span>
                        <button
                          onClick={() => handleUnstakeFixed(s.index)}
                          disabled={loading || !matured || s.claimed}
                          style={{
                            ...smallBtn,
                            opacity: !matured || s.claimed ? 0.5 : 1,
                          }}
                        >
                          Unstake
                        </button>
                      </div>
                      {pool && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {(Number(pool.apy) / 100).toFixed(2)}% APY · {formatDuration(pool.lockDuration)} lock
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {status && <div style={statusStyle(status)}>{status}</div>}
          {!isConnected && <div style={warning}>Please connect your wallet to continue.</div>}
        </div>
      </main>

      {showKYC && (
        <KYCModal
          amount={flexAmount || fixedAmount || '0'}
          threshold={formatUnits(kycThreshold, 18)}
          onClose={() => setShowKYC(false)}
          onCheckAgain={() => {
            setShowKYC(false);
            fetchState();
            if (pendingAction) {
              pendingAction();
              setPendingAction(null);
            }
          }}
        />
      )}
      </div>
    </WalletGate>
  );
}

function statusStyle(status: string | null): React.CSSProperties {
  const color = status?.toLowerCase().includes('failed') || status?.toLowerCase().includes('error')
    ? 'var(--danger)'
    : 'var(--accent-green)';
  return {
    marginTop: '14px',
    padding: '10px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border-color)',
    color,
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
  };
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-primary)',
};

const container: React.CSSProperties = {
  maxWidth: '640px',
  margin: '0 auto',
  padding: '40px 20px',
};

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: '16px',
  padding: '28px',
};

const heading: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: '6px',
};

const sub: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text-muted)',
  marginBottom: '20px',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
};

const infoRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '18px',
  paddingBottom: '14px',
  borderBottom: '1px solid var(--border-color)',
};

const balances: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
  marginBottom: '24px',
};

const balanceItem: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '12px',
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '10px',
  border: '1px solid var(--border-color)',
  fontSize: '13px',
};

const section: React.CSSProperties = {
  marginBottom: '28px',
  paddingBottom: '24px',
  borderBottom: '1px solid var(--border-color)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: '14px',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  fontSize: '15px',
  marginBottom: '12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
  color: '#fff',
  border: 'none',
  fontSize: '15px',
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '12px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
};

const row: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  marginTop: '12px',
};

const smallBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  background: 'rgba(0,255,136,0.1)',
  border: '1px solid rgba(0,255,136,0.3)',
  color: 'var(--accent-green)',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
};

const stakeCard: React.CSSProperties = {
  padding: '14px',
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '10px',
  border: '1px solid var(--border-color)',
};

const stakeRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '6px',
};

const ghostBtn: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: '10px',
  background: 'transparent',
  border: '1px solid var(--border-color)',
  color: 'var(--text-muted)',
  fontSize: '14px',
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
  marginTop: '10px',
};

const warning: React.CSSProperties = {
  marginTop: '16px',
  padding: '12px',
  borderRadius: '8px',
  background: 'rgba(245, 158, 11, 0.1)',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  color: 'var(--warning)',
  fontSize: '13px',
};

const error: React.CSSProperties = {
  marginTop: '12px',
  color: 'var(--danger)',
  fontSize: '13px',
};

const demoCode: React.CSSProperties = {
  marginBottom: '12px',
  padding: '10px',
  borderRadius: '8px',
  background: 'rgba(0, 212, 255, 0.1)',
  border: '1px solid rgba(0, 212, 255, 0.3)',
  color: 'var(--accent-cyan)',
  fontSize: '13px',
  fontFamily: "'JetBrains Mono', monospace",
};

const muted: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '12px',
};
