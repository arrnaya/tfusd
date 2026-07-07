'use client';

import { AuthProvider } from './AuthContext';
import { AdminProvider } from './AdminContext';
import { NetworkProvider } from './NetworkContext';
import { WalletProvider } from './WalletContext';
import { MyUSDProvider } from './MyUSDContext';
import { DAOProvider } from './DAOContext';
import { AuditProvider } from './AuditContext';
import { PublicAuthProvider } from './PublicAuthContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminProvider>
        <NetworkProvider>
          <WalletProvider>
            <PublicAuthProvider>
              <MyUSDProvider>
                <DAOProvider>
                  <AuditProvider>{children}</AuditProvider>
                </DAOProvider>
              </MyUSDProvider>
            </PublicAuthProvider>
          </WalletProvider>
        </NetworkProvider>
      </AdminProvider>
    </AuthProvider>
  );
}
