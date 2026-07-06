'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { AdminState, defaultAdminState, loadAdminState, saveAdminState } from '@/lib/admin-config';

interface AdminContextType {
  adminState: AdminState;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  shutdownDon: (id: number) => void;
  resumeDon: (id: number) => void;
  resetDons: () => void;
  setDon4Assets: (euroEnabled: boolean, maalEnabled: boolean) => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [adminState, setAdminState] = useState<AdminState>(defaultAdminState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = isAuthenticated && user?.role === 'admin';

  useEffect(() => {
    if (!isAuthenticated) {
      setAdminState(defaultAdminState);
      return;
    }
    setAdminState(loadAdminState());
  }, [isAuthenticated]);

  const persist = useCallback((next: AdminState) => {
    setAdminState(next);
    saveAdminState(next);
  }, []);

  function setCascadeErrors(state: AdminState, excludeId: number): AdminState {
    const next = { ...state, dons: { ...state.dons } };
    Object.keys(next.dons).forEach((key) => {
      const id = Number(key);
      if (id !== excludeId) {
        next.dons[id] = { ...next.dons[id], error: `DON-${excludeId} OFFLINE — sync compromised` };
      }
    });
    return next;
  }

  function clearCascadeErrors(state: AdminState): AdminState {
    const anyOffline = Object.values(state.dons).some((s) => !s.active);
    if (anyOffline) return state;
    const next = { ...state, dons: { ...state.dons } };
    Object.keys(next.dons).forEach((key) => {
      const id = Number(key);
      next.dons[id] = { ...next.dons[id], error: null };
    });
    return next;
  }

  function shutdownDon(id: number) {
    setLoading(true);
    const current = loadAdminState();
    let next = {
      ...current,
      dons: { ...current.dons, [id]: { active: false, error: null } },
    };
    next = setCascadeErrors(next, id);
    next = { ...next, updatedAt: new Date().toISOString() };
    persist(next);
    setLoading(false);
  }

  function resumeDon(id: number) {
    setLoading(true);
    const current = loadAdminState();
    let next = {
      ...current,
      dons: { ...current.dons, [id]: { active: true, error: null } },
    };
    next = clearCascadeErrors(next);
    next = { ...next, updatedAt: new Date().toISOString() };
    persist(next);
    setLoading(false);
  }

  function resetDons() {
    setLoading(true);
    const next = {
      ...defaultAdminState,
      updatedAt: new Date().toISOString(),
    };
    persist(next);
    setLoading(false);
  }

  function setDon4Assets(euroEnabled: boolean, maalEnabled: boolean) {
    setLoading(true);
    const current = loadAdminState();
    const next = {
      ...current,
      don4: { euroEnabled, maalEnabled },
      updatedAt: new Date().toISOString(),
    };
    persist(next);
    setLoading(false);
  }

  return (
    <AdminContext.Provider
      value={{
        adminState,
        isAdmin,
        loading,
        error,
        shutdownDon,
        resumeDon,
        resetDons,
        setDon4Assets,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}
