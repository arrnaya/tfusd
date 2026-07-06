'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  DAOParams,
  DAOProposal,
  DAOAuditEntry,
  loadDAOParams,
  saveDAOParams,
  loadDAOProposals,
  saveDAOProposals,
  loadDAOAudit,
  addAuditEntry,
  getDefaultDAOParams,
  createProposal as createProposalUtil,
} from '@/lib/dao-config';
import { updateDAOParams, loadAdminState, saveAdminState } from '@/lib/admin-config';
import { TFUSD_DAO_ABI } from '@/lib/dao-abi';
import { useWallet } from './WalletContext';
import { useNetwork } from './NetworkContext';

export interface DAOContextType {
  params: DAOParams;
  proposals: DAOProposal[];
  audit: DAOAuditEntry[];
  activeProposals: DAOProposal[];
  pastProposals: DAOProposal[];
  pendingExecution: DAOProposal[];
  updateParam: (key: keyof DAOParams, value: any, actor: string, role: string) => void;
  createProposal: (proposal: { title: string; description: string; parameterKey: keyof DAOParams | 'custom'; proposedValue: any }, actor: string, role: string) => DAOProposal;
  voteProposal: (proposalId: string, vote: 'for' | 'against' | 'abstain', voter: string) => void;
  executeProposal: (proposalId: string, actor: string, role: string) => Promise<void>;
  cancelProposal: (proposalId: string, actor: string, role: string) => void;
  refreshParams: () => void;
}

const DAOContext = createContext<DAOContextType | undefined>(undefined);

export function DAOProvider({ children }: { children: React.ReactNode }) {
  const [params, setParams] = useState<DAOParams>(loadDAOParams());
  const [proposals, setProposals] = useState<DAOProposal[]>(loadDAOProposals());
  const [audit, setAudit] = useState<DAOAuditEntry[]>(loadDAOAudit());
  const { signer, isConnected } = useWallet();
  const { networkConfig } = useNetwork();

  const getDaoContract = useCallback(() => {
    if (!signer) return null;
    return new ethers.Contract(networkConfig.daoAddress, TFUSD_DAO_ABI, signer);
  }, [signer, networkConfig.daoAddress]);

  const refreshParams = useCallback(() => {
    setParams(loadDAOParams());
    setProposals(loadDAOProposals());
    setAudit(loadDAOAudit());
  }, []);

  const updateParam = useCallback((key: keyof DAOParams, value: any, actor: string, role: string) => {
    const nextParams = { ...params, [key]: value };
    setParams(nextParams);
    saveDAOParams(nextParams);

    // Sync with admin state
    const adminState = loadAdminState();
    const nextAdminState = updateDAOParams(adminState, { [key]: value });
    saveAdminState(nextAdminState);

    addAuditEntry({
      action: 'dao-param-update',
      actor,
      role,
      details: `Updated ${key} from ${(params as any)[key]} to ${value}`,
      timestamp: new Date().toISOString(),
    });
    refreshParams();
  }, [params, refreshParams]);

  const createProposal = useCallback(
    (proposalData: { title: string; description: string; parameterKey: keyof DAOParams | 'custom'; proposedValue: any }, actor: string, role: string) => {
      const proposal = createProposalUtil(
        proposalData.title,
        proposalData.description,
        proposalData.parameterKey,
        proposalData.proposedValue,
        actor,
        role,
        params.votingPeriodHours
      );

      // Set current value for reference
      proposal.currentValue = proposalData.parameterKey !== 'custom' ? (params as any)[proposalData.parameterKey] : '';

      const nextProposals = [proposal, ...proposals];
      setProposals(nextProposals);
      saveDAOProposals(nextProposals);

      addAuditEntry({
        action: 'proposal-created',
        actor,
        role,
        details: `Created proposal: ${proposalData.title} (${proposalData.parameterKey} -> ${proposalData.proposedValue})`,
        timestamp: new Date().toISOString(),
      });
      refreshParams();
      return proposal;
    },
    [params, proposals, refreshParams]
  );

  const voteProposal = useCallback((proposalId: string, vote: 'for' | 'against' | 'abstain', voter: string) => {
    const nextProposals = proposals.map((p) => {
      if (p.id !== proposalId) return p;
      if (p.voters.includes(voter)) return p; // already voted

      const next = { ...p, voters: [...p.voters, voter] };
      if (vote === 'for') next.votesFor += 1;
      else if (vote === 'against') next.votesAgainst += 1;
      else next.votesAbstain += 1;

      // Check if voting period ended
      const now = new Date();
      const votingEnd = new Date(p.votingEndsAt);
      if (now > votingEnd) {
        // Determine outcome
        if (next.votesFor >= next.quorum && next.votesFor > next.votesAgainst) {
          next.status = 'passed';
        } else {
          next.status = 'rejected';
        }
      }

      return next;
    });

    setProposals(nextProposals);
    saveDAOProposals(nextProposals);
    refreshParams();
  }, [proposals, refreshParams]);

  const executeProposal = useCallback(async (proposalId: string, actor: string, role: string) => {
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.status !== 'passed') return;

    const now = new Date();
    const timelock = new Date(proposal.executionTimelockUntil || 0);
    if (now < timelock) {
      addAuditEntry({
        action: 'proposal-execute-failed',
        actor,
        role,
        details: `Failed to execute proposal ${proposalId}: timelock not expired`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let txHash: string | undefined;
    if (isConnected && signer && (proposal as any).onChainId) {
      try {
        const contract = getDaoContract();
        if (contract) {
          const tx = await contract.executeProposal((proposal as any).onChainId);
          const receipt = await tx.wait();
          txHash = receipt?.hash || tx.hash;
        }
      } catch (e: any) {
        addAuditEntry({
          action: 'proposal-execute-failed',
          actor,
          role,
          details: `On-chain execution failed: ${e?.reason || e?.message || 'unknown error'}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    // Execute parameter change if applicable
    if (proposal.parameterKey !== 'custom' && proposal.proposedValue !== undefined) {
      const nextParams = { ...params, [proposal.parameterKey]: proposal.proposedValue };
      setParams(nextParams);
      saveDAOParams(nextParams);

      // Sync with admin state
      const adminState = loadAdminState();
      const nextAdminState = updateDAOParams(adminState, { [proposal.parameterKey]: proposal.proposedValue });
      saveAdminState(nextAdminState);
    }

    const nextProposals = proposals.map((p) =>
      p.id === proposalId ? { ...p, status: 'executed' as const, executedAt: new Date().toISOString() } : p
    );
    setProposals(nextProposals);
    saveDAOProposals(nextProposals);

    addAuditEntry({
      action: 'proposal-executed',
      actor,
      role,
      details: `Executed proposal: ${proposal.title} (${proposal.parameterKey} -> ${proposal.proposedValue})${txHash ? ` tx:${txHash}` : ''}`,
      timestamp: new Date().toISOString(),
    });
    refreshParams();
  }, [proposals, params, refreshParams, isConnected, signer, getDaoContract]);

  const cancelProposal = useCallback((proposalId: string, actor: string, role: string) => {
    const nextProposals = proposals.map((p) =>
      p.id === proposalId ? { ...p, status: 'cancelled' as const } : p
    );
    setProposals(nextProposals);
    saveDAOProposals(nextProposals);

    addAuditEntry({
      action: 'proposal-cancelled',
      actor,
      role,
      details: `Cancelled proposal ${proposalId}`,
      timestamp: new Date().toISOString(),
    });
    refreshParams();
  }, [proposals, refreshParams]);

  // Auto-process expired proposals
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      let changed = false;
      const nextProposals = proposals.map((p) => {
        if (p.status !== 'active') return p;
        const votingEnd = new Date(p.votingEndsAt);
        if (now > votingEnd) {
          changed = true;
          if (p.votesFor >= p.quorum && p.votesFor > p.votesAgainst) {
            return { ...p, status: 'passed' as const };
          } else {
            return { ...p, status: 'rejected' as const };
          }
        }
        return p;
      });
      if (changed) {
        setProposals(nextProposals);
        saveDAOProposals(nextProposals);
      }
    }, 30000); // Check every 30s

    return () => clearInterval(timer);
  }, [proposals]);

  // Listen for storage changes (sync across tabs)
  useEffect(() => {
    const handler = () => refreshParams();
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [refreshParams]);

  const activeProposals = proposals.filter((p) => p.status === 'active' || p.status === 'pending');
  const pastProposals = proposals.filter((p) => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'executed');
  const pendingExecution = proposals.filter((p) => p.status === 'passed');

  return (
    <DAOContext.Provider
      value={{
        params,
        proposals,
        audit,
        activeProposals,
        pastProposals,
        pendingExecution,
        updateParam,
        createProposal,
        voteProposal,
        executeProposal,
        cancelProposal,
        refreshParams,
      }}
    >
      {children}
    </DAOContext.Provider>
  );
}

export function useDAO() {
  const ctx = useContext(DAOContext);
  if (!ctx) throw new Error('useDAO must be used within DAOProvider');
  return ctx;
}
