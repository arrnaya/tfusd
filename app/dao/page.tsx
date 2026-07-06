'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import { useDAO } from '@/components/DAOContext';
import Header from '@/components/Header';
import ConnectWallet from '@/components/ConnectWallet';
import { formatTimeAgo } from '@/lib/format-utils';

export default function DAOPage() {
  const router = useRouter();
  const { isAuthenticated, user, isGuardian, isAdmin } = useAuth();
  const { params, activeProposals, pastProposals, pendingExecution, createProposal, voteProposal, executeProposal, cancelProposal } = useDAO();
  const [activeTab, setActiveTab] = useState<'proposals' | 'params' | 'audit'>('proposals');
  const [showCreate, setShowCreate] = useState(false);
  const [newProposal, setNewProposal] = useState({ title: '', description: '', parameterKey: 'depegThreshold', proposedValue: '' });

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
          Authentication Required<br />
          <button onClick={() => router.push('/login')} style={{ marginTop: '12px', background: 'var(--accent-cyan)', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Go to Login</button>
        </div>
      </div>
    );
  }

  const hasProposalPermission = isGuardian || isAdmin;

  const paramLabels: Record<string, string> = {
    depegThreshold: 'Depeg Threshold',
    positiveDepegThreshold: 'Positive Depeg Threshold',
    criticalDepegThreshold: 'Critical Depeg Threshold',
    poolReplenishThreshold: 'Pool Replenish Threshold',
    autoMintOnDepeg: 'Auto-Mint on Depeg',
    autoBurnOnPositiveDepeg: 'Auto-Burn on Positive Depeg',
    autoReplenishPool: 'Auto-Replenish Pool',
    maxAutoMintAmount: 'Max Auto-Mint Amount',
    maxAutoBurnAmount: 'Max Auto-Burn Amount',
    mintPauseDurationMinutes: 'Mint Pause Duration (min)',
    guardianQuorum: 'Guardian Quorum',
    proposalTimelockHours: 'Proposal Timelock (hrs)',
    votingPeriodHours: 'Voting Period (hrs)',
  };

  const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' };
  const cardHeaderStyle: React.CSSProperties = { padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const cardTitleStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' };
  const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px', display: 'block' };
  const inputStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", outline: 'none', width: '100%', marginBottom: '14px' };
  const btnStyle = (bg: string): React.CSSProperties => ({ width: '100%', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', background: bg, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', position: 'relative' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)', backgroundSize: '50px 50px', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', top: '-50%', left: '-50%', width: '200%', height: '200%', background: 'radial-gradient(circle at 30% 30%, rgba(0,212,255,0.05) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(168,85,247,0.05) 0%, transparent 50%)', pointerEvents: 'none', zIndex: 0 }} />
      <Header />
      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '24px', position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>DAO Governance</h1>
          <ConnectWallet />
          <div style={{ display: 'flex', gap: '4px', padding: '4px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            {(['proposals', 'params', 'audit'] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '8px 18px', borderRadius: '8px', border: activeTab === tab ? '1px solid rgba(0,212,255,0.2)' : '1px solid transparent', background: activeTab === tab ? 'rgba(0,212,255,0.08)' : 'transparent', color: activeTab === tab ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tab}</button>
            ))}
          </div>
        </div>

        {/* PROPOSALS TAB */}
        {activeTab === 'proposals' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {hasProposalPermission && !showCreate && (
              <button onClick={() => setShowCreate(true)} style={{ ...btnStyle('linear-gradient(135deg, #00d4ff, #0088ff)'), width: 'fit-content', padding: '10px 24px' }}>+ Create Proposal</button>
            )}
            {showCreate && (
              <div style={cardStyle}>
                <div style={cardHeaderStyle}><div style={cardTitleStyle}>Create New Proposal</div></div>
                <div style={{ padding: '20px' }}>
                  <label style={labelStyle}>Title</label>
                  <input value={newProposal.title} onChange={(e) => setNewProposal({ ...newProposal, title: e.target.value })} placeholder="Proposal title" style={inputStyle} />
                  <label style={labelStyle}>Description</label>
                  <textarea value={newProposal.description} onChange={(e) => setNewProposal({ ...newProposal, description: e.target.value })} placeholder="Describe the rationale for this proposal..." style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} />
                  <label style={labelStyle}>Parameter</label>
                  <select value={newProposal.parameterKey} onChange={(e) => setNewProposal({ ...newProposal, parameterKey: e.target.value })} style={inputStyle}>
                    {Object.keys(paramLabels).map((k) => <option key={k} value={k}>{paramLabels[k]}</option>)}
                  </select>
                  <label style={labelStyle}>Proposed Value</label>
                  <input value={newProposal.proposedValue} onChange={(e) => setNewProposal({ ...newProposal, proposedValue: e.target.value })} placeholder="New value" style={inputStyle} />
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => {
                      if (user && newProposal.title && newProposal.proposedValue) {
                        createProposal({ title: newProposal.title, description: newProposal.description, parameterKey: newProposal.parameterKey as any, proposedValue: newProposal.proposedValue }, user.email, user.role);
                        setShowCreate(false);
                        setNewProposal({ title: '', description: '', parameterKey: 'depegThreshold', proposedValue: '' });
                      }
                    }} style={{ ...btnStyle('linear-gradient(135deg, #00d4ff, #0088ff)'), flex: 1 }}>Submit</button>
                    <button onClick={() => setShowCreate(false)} style={{ ...btnStyle('linear-gradient(135deg, #666, #444)'), flex: 1 }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Active Proposals */}
            {activeProposals.length > 0 && (
              <div>
                <div style={{ ...cardTitleStyle, marginBottom: '12px', fontSize: '16px' }}>Active Proposals ({activeProposals.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {activeProposals.map((p) => (
                    <div key={p.id} style={cardStyle}>
                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{p.title}</div>
                          <div style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(0,212,255,0.1)', color: 'var(--accent-cyan)', fontSize: '11px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{p.status.toUpperCase()}</div>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>{p.description}</div>
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                          <span>Param: {paramLabels[p.parameterKey] || p.parameterKey}</span>
                          <span>Current: {String(p.currentValue)}</span>
                          <span>Proposed: {String(p.proposedValue)}</span>
                          <span>Voting ends: {formatTimeAgo(p.votingEndsAt)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                          <div style={{ flex: 1, height: '6px', background: 'rgba(0,255,136,0.1)', borderRadius: '3px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (p.votesFor / (p.quorum || 1)) * 100)}%`, background: '#00ff88', borderRadius: '3px' }} /></div>
                          <div style={{ flex: 1, height: '6px', background: 'rgba(239,68,68,0.1)', borderRadius: '3px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (p.votesAgainst / (p.quorum || 1)) * 100)}%`, background: '#ef4444', borderRadius: '3px' }} /></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '12px' }}>
                          <span style={{ color: '#00ff88' }}>For: {p.votesFor}</span>
                          <span style={{ color: '#ef4444' }}>Against: {p.votesAgainst}</span>
                          <span>Abstain: {p.votesAbstain}</span>
                          <span>Quorum: {p.quorum}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => user && voteProposal(p.id, 'for', user.email)} style={{ ...btnStyle('linear-gradient(135deg, #00ff88, #00aa66)'), flex: 1, padding: '10px' }}>Vote For</button>
                          <button onClick={() => user && voteProposal(p.id, 'against', user.email)} style={{ ...btnStyle('linear-gradient(135deg, #ef4444, #ff3366)'), flex: 1, padding: '10px' }}>Vote Against</button>
                          <button onClick={() => user && voteProposal(p.id, 'abstain', user.email)} style={{ ...btnStyle('linear-gradient(135deg, #666, #444)'), flex: 1, padding: '10px' }}>Abstain</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Execution */}
            {pendingExecution.length > 0 && (
              <div>
                <div style={{ ...cardTitleStyle, marginBottom: '12px', fontSize: '16px', color: 'var(--accent-purple)' }}>Pending Execution ({pendingExecution.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {pendingExecution.map((p) => (
                    <div key={p.id} style={{ ...cardStyle, border: '1px solid var(--accent-purple)' }}>
                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{p.title}</div>
                          <div style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(168,85,247,0.1)', color: 'var(--accent-purple)', fontSize: '11px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>PASSED</div>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>{p.description}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '12px' }}>Votes: {p.votesFor} for / {p.votesAgainst} against | Quorum: {p.quorum}</div>
                        {hasProposalPermission && (
                          <button onClick={() => user && executeProposal(p.id, user.email, user.role)} style={{ ...btnStyle('linear-gradient(135deg, var(--accent-purple), #7c3aed)'), width: 'fit-content', padding: '10px 24px' }}>Execute Proposal</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past Proposals */}
            {pastProposals.length > 0 && (
              <div>
                <div style={{ ...cardTitleStyle, marginBottom: '12px', fontSize: '16px', color: 'var(--text-muted)' }}>Past Proposals ({pastProposals.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {pastProposals.map((p) => (
                    <div key={p.id} style={{ ...cardStyle, opacity: 0.7 }}>
                      <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.title}</div>
                          <div style={{ padding: '4px 10px', borderRadius: '6px', background: p.status === 'executed' ? 'rgba(0,255,136,0.1)' : 'rgba(100,100,100,0.1)', color: p.status === 'executed' ? '#00ff88' : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{p.status.toUpperCase()}</div>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Votes: {p.votesFor} / {p.votesAgainst} | {formatTimeAgo(p.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeProposals.length === 0 && pendingExecution.length === 0 && pastProposals.length === 0 && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: '60px' }}>
                <div style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>No proposals yet. Create one to start governance.</div>
              </div>
            )}
          </div>
        )}

        {/* PARAMS TAB */}
        {activeTab === 'params' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {Object.entries(params).map(([key, value]) => (
              <div key={key} style={cardStyle}>
                <div style={cardHeaderStyle}><div style={cardTitleStyle}>{paramLabels[key] || key}</div></div>
                <div style={{ padding: '20px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace" }}>{String(value)}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: "'JetBrains Mono', monospace" }}>Current value</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AUDIT TAB */}
        {activeTab === 'audit' && (
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><div style={cardTitleStyle}>Audit Log</div></div>
            <div style={{ padding: 0, maxHeight: '600px', overflowY: 'auto' }}>
              {/* Audit log would be loaded from DAOContext - simplified for now */}
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>Audit log is maintained in local storage and synced across sessions.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
