import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Treuhand Finanzgruppe USD (TFUSD) Decentralized Oracle Network',
  description: 'Treuhand Finanzgruppe USD (TFUSD) Stablecoin — Proof of Reserves, Supply Management & DAO Governance Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
