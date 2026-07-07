'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface PublicUser {
  email: string;
  kycVerified?: boolean;
}

interface PublicAuthContextType {
  user: PublicUser | null;
  isAuthenticated: boolean;
  isSending: boolean;
  email: string;
  setEmail: (email: string) => void;
  sendOTP: () => Promise<{ success: boolean; error?: string; simulatedCode?: string }>;
  verifyOTP: (code: string) => { success: boolean; error?: string };
  logout: () => void;
}

const PublicAuthContext = createContext<PublicAuthContextType | undefined>(undefined);

const SESSION_KEY = 'tfusd_public_auth';
const OTP_PENDING_KEY = 'tfusd_public_otp';
const OTP_TTL_MS = 10 * 60 * 1000; // code valid 10 minutes

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function PublicAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [email, setEmailState] = useState('');
  const [pendingOTP, setPendingOTP] = useState<{ code: string; email: string; expiresAt: number } | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw) as PublicUser & { expiresAt?: number };
        if (!session.expiresAt || session.expiresAt > Date.now()) {
          setUser(session);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      }
      const pendingRaw = localStorage.getItem(OTP_PENDING_KEY);
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw) as { code: string; email: string; expiresAt: number };
        if (pending.expiresAt > Date.now()) {
          setPendingOTP(pending);
          setEmailState(pending.email);
        } else {
          localStorage.removeItem(OTP_PENDING_KEY);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const setEmail = useCallback((value: string) => {
    setEmailState(value);
  }, []);

  const sendOTP = useCallback(async () => {
    if (!email || !email.includes('@')) {
      return { success: false, error: 'Please enter a valid email address.' };
    }
    setIsSending(true);
    try {
      const code = generateCode();
      const pending = { code, email, expiresAt: Date.now() + OTP_TTL_MS };
      localStorage.setItem(OTP_PENDING_KEY, JSON.stringify(pending));
      setPendingOTP(pending);

      const apiUrl = process.env.NEXT_PUBLIC_OTP_API_URL;
      if (apiUrl) {
        await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
        return { success: true };
      }

      // Demo / local fallback: expose the code so the UI can show it.
      return { success: true, simulatedCode: code };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to send OTP.' };
    } finally {
      setIsSending(false);
    }
  }, [email]);

  const verifyOTP = useCallback(
    (code: string) => {
      if (!pendingOTP) {
        return { success: false, error: 'No OTP pending. Please request a new code.' };
      }
      if (Date.now() > pendingOTP.expiresAt) {
        return { success: false, error: 'OTP expired. Please request a new code.' };
      }
      if (code.trim() !== pendingOTP.code) {
        return { success: false, error: 'Invalid OTP. Please try again.' };
      }
      const session = { email: pendingOTP.email, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      localStorage.removeItem(OTP_PENDING_KEY);
      setUser({ email: pendingOTP.email });
      setPendingOTP(null);
      return { success: true };
    },
    [pendingOTP]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(OTP_PENDING_KEY);
    setUser(null);
    setPendingOTP(null);
    setEmailState('');
  }, []);

  return (
    <PublicAuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isSending,
        email,
        setEmail,
        sendOTP,
        verifyOTP,
        logout,
      }}
    >
      {children}
    </PublicAuthContext.Provider>
  );
}

export function usePublicAuth() {
  const ctx = useContext(PublicAuthContext);
  if (!ctx) throw new Error('usePublicAuth must be used within PublicAuthProvider');
  return ctx;
}
