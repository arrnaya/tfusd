// Admin state configuration (UI-side only) with DAO parameter integration

export interface DonAdminState {
  active: boolean;
  error: string | null;
}

export interface Don4AssetState {
  euroEnabled: boolean;
  maalEnabled: boolean;
}

export interface DAOParamsState {
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

export interface AdminState {
  dons: Record<number, DonAdminState>;
  don4: Don4AssetState;
  daoParams: DAOParamsState;
  updatedAt: string;
}

export const defaultDAOParams: DAOParamsState = {
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

export const defaultAdminState: AdminState = {
  dons: {
    1: { active: true, error: null },
    2: { active: true, error: null },
    3: { active: true, error: null },
    4: { active: true, error: null },
  },
  don4: { euroEnabled: true, maalEnabled: true },
  daoParams: defaultDAOParams,
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEY = 'dons_admin_state';

export function loadAdminState(): AdminState {
  if (typeof window === 'undefined') return defaultAdminState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAdminState;
    const parsed = JSON.parse(raw) as AdminState;
    // Validate shape
    if (!parsed.dons || !parsed.don4) return defaultAdminState;
    // Merge in DAO params if missing (backward compatibility)
    if (!parsed.daoParams) {
      parsed.daoParams = defaultDAOParams;
    }
    return parsed;
  } catch {
    return defaultAdminState;
  }
}

export function saveAdminState(state: AdminState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function updateDAOParams(state: AdminState, params: Partial<DAOParamsState>): AdminState {
  return {
    ...state,
    daoParams: { ...state.daoParams, ...params },
    updatedAt: new Date().toISOString(),
  };
}
