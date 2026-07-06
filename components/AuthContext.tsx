'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getUserByEmail, SESSION_DURATION_MS, AUTH_VERSION, isAdmin, isGuardian, isMinter, getUserRole } from '@/lib/auth-config';

interface AuthSession {
  email: string;
  name: string;
  role: string;
  expiresAt: number;
  authVersion: number;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthSession | null;
  pendingEmail: string | null;
  stage: 'idle' | 'password-verified' | 'authenticated';
  loginWithPassword: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  verifyPin: (code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAdmin: boolean;
  isGuardian: boolean;
  isMinter: boolean;
  userRole: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'dons_auth_session';
const PENDING_STAGE_KEY = 'dons_pending_stage';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthSession | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'password-verified' | 'authenticated'>('idle');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session: AuthSession = JSON.parse(raw);
        if (session.expiresAt > Date.now() && session.authVersion === AUTH_VERSION) {
          setUser(session);
          setIsAuthenticated(true);
          setStage('authenticated');
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      }
      const pendingRaw = localStorage.getItem(PENDING_STAGE_KEY);
      if (pendingRaw) {
        const pendingData = JSON.parse(pendingRaw);
        if (pendingData.expiresAt > Date.now()) {
          setPendingEmail(pendingData.email);
          setStage('password-verified');
        } else {
          localStorage.removeItem(PENDING_STAGE_KEY);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  async function loginWithPassword(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    const userConfig = getUserByEmail(email);
    if (!userConfig) {
      return { success: false, error: 'Invalid credentials.' };
    }
    if (userConfig.password !== password) {
      return { success: false, error: 'Invalid credentials.' };
    }

    const pendingData = {
      email,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    localStorage.setItem(PENDING_STAGE_KEY, JSON.stringify(pendingData));
    setPendingEmail(email);
    setStage('password-verified');
    return { success: true };
  }

  async function verifyPin(code: string): Promise<{ success: boolean; error?: string }> {
    if (!pendingEmail) {
      return { success: false, error: 'No active session found. Please sign in again.' };
    }

    const userConfig = getUserByEmail(pendingEmail);
    if (!userConfig) {
      return { success: false, error: 'User configuration not found.' };
    }

    if (code !== userConfig.pin) {
      return { success: false, error: 'Invalid PIN. Please try again.' };
    }

    const session: AuthSession = {
      email: pendingEmail,
      name: userConfig.name || pendingEmail,
      role: userConfig.role,
      expiresAt: Date.now() + SESSION_DURATION_MS,
      authVersion: AUTH_VERSION,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(PENDING_STAGE_KEY);
    setUser(session);
    setIsAuthenticated(true);
    setStage('authenticated');
    setPendingEmail(null);
    return { success: true };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PENDING_STAGE_KEY);
    setUser(null);
    setIsAuthenticated(false);
    setPendingEmail(null);
    setStage('idle');
  }

  const userRole = user?.role || null;

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        pendingEmail,
        stage,
        loginWithPassword,
        verifyPin,
        logout,
        isAdmin: isAdmin(user?.email || ''),
        isGuardian: isGuardian(user?.email || ''),
        isMinter: isMinter(user?.email || ''),
        userRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
