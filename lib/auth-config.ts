// Auth configuration for Treuhand Finanzgruppe USD (TFUSD) Dashboard
// Add allowed emails, passwords, and 6-digit PINs here.
// Bump AUTH_VERSION whenever credentials change to force re-authentication.

export const AUTH_VERSION = 2;

export enum UserRole {
  VIEWER = 'viewer',
  OPERATOR = 'operator',
  MINTER = 'minter',
  GUARDIAN = 'guardian',
  ADMIN = 'admin',
}

export interface UserAuthConfig {
  email: string;
  password: string;
  pin: string; // 6-digit numeric code
  name: string;
  role: UserRole;
}

export const ALLOWED_USERS: UserAuthConfig[] = [
  {
    email: 'admin@tfusd.io',
    password: 'Admin2026',
    pin: '003456',
    name: 'Admin',
    role: UserRole.ADMIN,
  },
  {
    email: 'guardian@tfusd.io',
    password: 'Guardian2026!',
    pin: '112233',
    name: 'DAO Guardian',
    role: UserRole.GUARDIAN,
  },
  {
    email: 'minter@tfusd.io',
    password: 'Minter2026!',
    pin: '445566',
    name: 'Minter Operator',
    role: UserRole.MINTER,
  },
  {
    email: 'operator@tfusd.io',
    password: 'Operator2026!',
    pin: '778899',
    name: 'Network Operator',
    role: UserRole.OPERATOR,
  },
  {
    email: 'viewer@tfusd.io',
    password: 'Viewer2026!',
    pin: '000111',
    name: 'Viewer',
    role: UserRole.VIEWER,
  },
];

export function getUserByEmail(email: string): UserAuthConfig | undefined {
  return ALLOWED_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED_USERS.some((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function getUserRole(email: string): UserRole | null {
  const user = getUserByEmail(email);
  return user?.role || null;
}

export function isAdmin(email: string): boolean {
  return getUserRole(email) === UserRole.ADMIN;
}

export function isGuardian(email: string): boolean {
  const role = getUserRole(email);
  return role === UserRole.GUARDIAN || role === UserRole.ADMIN;
}

export function isMinter(email: string): boolean {
  const role = getUserRole(email);
  return role === UserRole.MINTER || role === UserRole.GUARDIAN || role === UserRole.ADMIN;
}

export function hasActionPermission(email: string, action: 'mint' | 'burn' | 'replenish' | 'emergency-pause' | 'config'): boolean {
  const role = getUserRole(email);
  if (!role) return false;
  switch (action) {
    case 'mint':
    case 'burn':
      return role === UserRole.MINTER || role === UserRole.GUARDIAN || role === UserRole.ADMIN;
    case 'replenish':
    case 'emergency-pause':
    case 'config':
      return role === UserRole.GUARDIAN || role === UserRole.ADMIN;
    default:
      return false;
  }
}

// Session duration in milliseconds (default: 10 minutes)
export const SESSION_DURATION_MS = 10 * 60 * 1000;
