'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import Header from '@/components/Header';
import ConnectWallet from '@/components/ConnectWallet';
import { usePublicAuth } from '@/components/PublicAuthContext';
import { useWallet } from '@/components/WalletContext';
import { useNetwork } from '@/components/NetworkContext';
import KYCModal from '@/components/KYCModal';
import { TREASURY_ABI } from '@/lib/treasury-abi';
import { TFUSD_ABI } from '@/lib/contract-abi';
import { ERC20_ABI, getTreasuryConfig, parseUnits, formatUnits } from '@/lib/treasury-config';

export default function MintPage() {
  const { isAuthenticated, user, email, setEmail, sendOTP, verifyOTP, logout } = usePublicAuth();
  const { signer, address, isConnected, ethersProvider } = useWallet();
  const { networkConfig } = useNetwork();

  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [simulatedCode, setSimulatedCode] = useState<string | undefined>();
  const [otpError, setOtpError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('USDC');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showKYC, setShowKYC] = useState(false);

  const [tfusdBalance, setTfusdBalance] = useState<bigint>(0n);
  const [collateralBalance, setCollateralBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [kycThreshold, setKycThreshold] = useState<bigint>(0n);
  const [totalMintedByUser, setTotalMintedByUser] = useState<bigint>(0n);
  const [isKYCPassed, setIsKYCPassed] = useState(false);

  const treasuryConfig = useMemo(() => getTreasuryConfig(networkConfig.key as any), [networkConfig.key]);
  const collateral = useMemo(
    () => treasuryConfig.collaterals.find((c) => c.symbol === selectedSymbol) || treasuryConfig.collaterals[0],
    [treasuryConfig, selectedSymbol]
  );

  const treasury = useMemo(() => {
    if (!ethersProvider) return null;
    return new ethers.Contract(treasuryConfig.treasuryAddress, TREASURY_ABI, ethersProvider);
  }, [ethersProvider, treasuryConfig.treasuryAddress]);

  const tfusd = useMemo(() => {
    if (!ethersProvider) return null;
    return new ethers.Contract(treasuryConfig.tfusdAddress, TFUSD_ABI, ethersProvider);
  }, [ethersProvider, treasuryConfig.tfusdAddress]);

  const collateralToken = useMemo(() => {
    if (!ethersProvider) return null;
    return new ethers.Contract(collateral.address, ERC20_ABI, ethersProvider);
  }, [ethersProvider, collateral.address]);

  const fetchState = useCallback(async () => {
    if (!address || !treasury || !tfusd || !collateralToken) return;
    try {
      const [tb, cb, al, thr, tmu, kyc] = await Promise.all([
        tfusd.balanceOf(address),
        collateralToken.balanceOf(address),
        collateralToken.allowance(address, treasuryConfig.treasuryAddress),
        treasury.kycThreshold(),
        treasury.totalMintedByUser(address),
        treasury.isKYCPassed(address),
      ]);
      setTfusdBalance(tb);
      setCollateralBalance(cb);
      setAllowance(al);
      setKycThreshold(thr);
      setTotalMintedByUser(tmu);
      setIsKYCPassed(kyc);
    } catch (e: any) {
      console.error('fetchState error', e);
    }
  }, [address, treasury, tfusd, collateralToken, treasuryConfig.treasuryAddress]);

  useEffect(() => {
    fetchState();
  }, [fetchState, selectedSymbol, address, isConnected]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount || isNaN(Number(amount))) return 0n;
      return parseUnits(amount, collateral.decimals);
    } catch {
      return 0n;
    }
  }, [amount, collateral.decimals]);

  const tfusdAmount = useMemo(() => {
    try {
      if (!amount || isNaN(Number(amount))) return 0n;
      return parseUnits(amount, 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const needsKYC = useMemo(() => {
    if (kycThreshold === 0n) return false;
    return tfusdAmount + totalMintedByUser > kycThreshold && !isKYCPassed;
  }, [tfusdAmount, totalMintedByUser, kycThreshold, isKYCPassed]);

  const needsApprove = useMemo(() => {
    return parsedAmount > 0n && allowance < parsedAmount;
  }, [parsedAmount, allowance]);

  const handleSendOTP = async () => {
    setOtpError(null);
    const res = await sendOTP();
    if (res.success) {
      setOtpSent(true);
      setSimulatedCode(res.simulatedCode);
    } else {
      setOtpError(res.error || 'Failed to send OTP');
    }
  };

  const handleVerifyOTP = () => {
    setOtpError(null);
    const res = verifyOTP(otp);
    if (!res.success) setOtpError(res.error || 'Invalid OTP');
  };

  const handleApprove = async () => {
    if (!signer || !collateralToken || parsedAmount === 0n) return;
    setLoading(true);
    setStatus('Approving collateral...');
    try {
      const tx = await (collateralToken.connect(signer) as ethers.Contract).approve(
        treasuryConfig.treasuryAddress,
        parsedAmount
      );
      await tx.wait();
      setStatus('Approval confirmed.');
      await fetchState();
    } catch (e: any) {
      setStatus(`Approval failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleMint = async () => {
    if (!signer || !treasury || parsedAmount === 0n) return;
    if (needsKYC) {
      setShowKYC(true);
      return;
    }
    if (needsApprove) {
      await handleApprove();
      return;
    }
    setLoading(true);
    setStatus('Minting TFUSD...');
    try {
      const tx = await (treasury.connect(signer) as ethers.Contract).depositAndMint(collateral.address, parsedAmount);
      await tx.wait();
      setStatus(`Minted ${amount} TFUSD successfully.`);
      setAmount('');
      await fetchState();
    } catch (e: any) {
      setStatus(`Mint failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={page}>
        <Header />
        <main style={container}>
          <div style={card}>
            <h1 style={heading}>Mint TFUSD</h1>
            <p style={sub}>Enter your email to receive a one-time passcode.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={input}
              disabled={otpSent}
            />
            {!otpSent ? (
              <button onClick={handleSendOTP} style={primaryBtn}>
                Send OTP
              </button>
            ) : (
              <>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  style={input}
                  maxLength={6}
                />
                {simulatedCode && (
                  <div style={demoCode}>Demo code: <strong>{simulatedCode}</strong></div>
                )}
                <button onClick={handleVerifyOTP} style={primaryBtn}>
                  Verify & Continue
                </button>
                <button onClick={() => setOtpSent(false)} style={ghostBtn}>
                  Use another email
                </button>
              </>
            )}
            {otpError && <div style={error}>{otpError}</div>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={page}>
      <Header />
      <main style={container}>
        <div style={card}>
          <div style={headerRow}>
            <h1 style={heading}>Mint TFUSD</h1>
            <ConnectWallet />
          </div>
          <p style={sub}>Deposit USDT or USDC and receive TFUSD 1:1.</p>

          {user && (
            <div style={infoRow}>
              <span style={muted}>Logged in as {user.email}</span>
              <button onClick={logout} style={smallGhost}>Logout</button>
            </div>
          )}

          <div style={balances}>
            <div style={balanceItem}>
              <span style={muted}>TFUSD Balance</span>
              <strong>{formatUnits(tfusdBalance, 18)} TFUSD</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>{collateral.symbol} Balance</span>
              <strong>{formatUnits(collateralBalance, collateral.decimals)} {collateral.symbol}</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>KYC Threshold</span>
              <strong>{formatUnits(kycThreshold, 18)} TFUSD</strong>
            </div>
            <div style={balanceItem}>
              <span style={muted}>KYC Status</span>
              <strong style={{ color: isKYCPassed ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                {isKYCPassed ? 'Verified' : 'Not Verified'}
              </strong>
            </div>
          </div>

          <label style={label}>Collateral</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            style={input}
          >
            {treasuryConfig.collaterals.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.icon} {c.symbol}
              </option>
            ))}
          </select>

          <label style={label}>Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            style={input}
            min="0"
            step="0.01"
          />

          {needsKYC && (
            <div style={warning}>
              This amount requires KYC. <button style={linkBtn} onClick={() => setShowKYC(true)}>Complete KYC</button>
            </div>
          )}

          <button
            onClick={handleMint}
            disabled={loading || !isConnected || parsedAmount === 0n}
            style={{ ...primaryBtn, opacity: loading || !isConnected || parsedAmount === 0n ? 0.6 : 1 }}
          >
            {loading ? 'Processing...' : needsApprove ? 'Approve & Mint' : 'Mint TFUSD'}
          </button>

          {status && <div style={statusStyle(status)}>{status}</div>}

          {!isConnected && <div style={warning}>Please connect your wallet to continue.</div>}
        </div>
      </main>

      {showKYC && (
        <KYCModal
          amount={amount || '0'}
          threshold={formatUnits(kycThreshold, 18)}
          onClose={() => setShowKYC(false)}
          onCheckAgain={() => {
            setShowKYC(false);
            fetchState();
          }}
        />
      )}
    </div>
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
  maxWidth: '560px',
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
  marginBottom: '20px',
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

const label: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: '6px',
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  fontSize: '15px',
  marginBottom: '16px',
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

const smallGhost: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  color: 'var(--text-muted)',
  borderRadius: '6px',
  padding: '4px 10px',
  fontSize: '11px',
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
};

const warning: React.CSSProperties = {
  marginBottom: '16px',
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

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent-cyan)',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  fontSize: '13px',
};
