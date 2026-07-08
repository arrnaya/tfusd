'use client';

import { AuthProvider } from './AuthContext';
import { AdminProvider } from './AdminContext';
import { NetworkProvider } from './NetworkContext';
import { WalletProvider } from './WalletContext';
import { MyUSDProvider } from './MyUSDContext';
import { DAOProvider } from './DAOContext';
import { AuditProvider } from './AuditContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminProvider>
        <NetworkProvider>
          <WalletProvider>
            <MyUSDProvider>
              <DAOProvider>
                <AuditProvider>{children}</AuditProvider>
              </DAOProvider>
            </MyUSDProvider>
          </WalletProvider>
        </NetworkProvider>
      </AdminProvider>
    </AuthProvider>
  );
}
