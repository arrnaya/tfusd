export interface DAOProposal {
  id: string;
  title: string;
  description: string;
  parameterKey: keyof DAOParams | 'custom';
  proposedValue: string | number | boolean;
  currentValue: string | number | boolean;
  proposer: string;
  proposerRole: string;
  status: 'pending' | 'active' | 'passed' | 'rejected' | 'executed' | 'cancelled';
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  createdAt: string;
  votingEndsAt: string;
  executedAt: string | null;
  executionTimelockUntil: string | null;
  quorum: number;
  voters: string[];
}

export interface DAOParams {
  depegThreshold: number;
  positiveDepegThreshold: number;
  criticalDepegThreshold: number;
  poolReplenishThreshold: number;
  autoMintOnDepeg: boolean;
  autoBurnOnPositiveDepeg: boolean;
  autoReplenishPool: boolean;
  maxAutoMintAmount: string;
  maxAutoBurnAmount: string;
  mintPauseDurationMinutes: number;
  guardianQuorum: number;
  proposalTimelockHours: number;
  votingPeriodHours: number;
}

export interface DAOAuditEntry {
  id: string;
  action: string;
  actor: string;
  role: string;
  details: string;
  timestamp: string;
}

export const DAO_STORAGE_KEYS = {
  params: 'tfusd_dao_params',
  proposals: 'tfusd_dao_proposals',
  audit: 'tfusd_dao_audit',
};

export function loadDAOParams(): DAOParams {
  if (typeof window === 'undefined') return getDefaultDAOParams();
  try {
    const raw = localStorage.getItem(DAO_STORAGE_KEYS.params);
    if (!raw) return getDefaultDAOParams();
    return { ...getDefaultDAOParams(), ...JSON.parse(raw) };
  } catch {
    return getDefaultDAOParams();
  }
}

export function saveDAOParams(params: DAOParams) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DAO_STORAGE_KEYS.params, JSON.stringify(params));
  } catch {
    // ignore
  }
}

export function loadDAOProposals(): DAOProposal[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DAO_STORAGE_KEYS.proposals);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveDAOProposals(proposals: DAOProposal[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DAO_STORAGE_KEYS.proposals, JSON.stringify(proposals));
  } catch {
    // ignore
  }
}

export function loadDAOAudit(): DAOAuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DAO_STORAGE_KEYS.audit);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveDAOAudit(audit: DAOAuditEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DAO_STORAGE_KEYS.audit, JSON.stringify(audit.slice(-500)));
  } catch {
    // ignore
  }
}

export function addAuditEntry(entry: Omit<DAOAuditEntry, 'id'>) {
  const audit = loadDAOAudit();
  const newEntry: DAOAuditEntry = {
    ...entry,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  audit.push(newEntry);
  saveDAOAudit(audit);
  return newEntry;
}

export function getDefaultDAOParams(): DAOParams {
  return {
    depegThreshold: 0.995,
    positiveDepegThreshold: 1.005,
    criticalDepegThreshold: 0.98,
    poolReplenishThreshold: 0.5,
    autoMintOnDepeg: true,
    autoBurnOnPositiveDepeg: true,
    autoReplenishPool: true,
    maxAutoMintAmount: '100000000',
    maxAutoBurnAmount: '100000000',
    mintPauseDurationMinutes: 60,
    guardianQuorum: 2,
    proposalTimelockHours: 24,
    votingPeriodHours: 72,
  };
}

export function generateProposalId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createProposal(
  title: string,
  description: string,
  parameterKey: keyof DAOParams | 'custom',
  proposedValue: string | number | boolean,
  proposer: string,
  proposerRole: string,
  votingPeriodHours: number = 72
): DAOProposal {
  const now = new Date();
  const votingEnds = new Date(now.getTime() + votingPeriodHours * 60 * 60 * 1000);
  const timelock = new Date(votingEnds.getTime() + 24 * 60 * 60 * 1000);
  return {
    id: generateProposalId(),
    title,
    description,
    parameterKey,
    proposedValue,
    currentValue: '',
    proposer,
    proposerRole,
    status: 'active',
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    createdAt: now.toISOString(),
    votingEndsAt: votingEnds.toISOString(),
    executedAt: null,
    executionTimelockUntil: timelock.toISOString(),
    quorum: 2,
    voters: [],
  };
}
