// URL masking utility for Treuhand Finanzgruppe USD (TFUSD) platform
// Actual fetch URLs remain pointing to api.infinnity.capital
// Display URLs are masked to tfusd.io for UI presentation

export const REAL_API_BASE = 'https://api.infinnity.capital';
export const REAL_POR_API_BASE = 'https://por-api.infinnity.capital';
export const DISPLAY_API_BASE = 'https://tfusd.io';
export const DISPLAY_POR_API_BASE = 'https://tfusd.io';

/**
 * Mask a real API URL for display purposes only.
 * Does NOT modify the actual fetch URL.
 */
export function maskApiUrl(realUrl: string): string {
  if (realUrl.startsWith(REAL_POR_API_BASE)) {
    return realUrl.replace(REAL_POR_API_BASE, DISPLAY_POR_API_BASE);
  }
  if (realUrl.startsWith(REAL_API_BASE)) {
    return realUrl.replace(REAL_API_BASE, DISPLAY_API_BASE);
  }
  return realUrl;
}

/**
 * Get the real API URL for fetch calls.
 * If a display URL is passed, convert back to real.
 */
export function realApiUrl(displayUrl: string): string {
  if (displayUrl.startsWith(DISPLAY_POR_API_BASE)) {
    return displayUrl.replace(DISPLAY_POR_API_BASE, REAL_POR_API_BASE);
  }
  if (displayUrl.startsWith(DISPLAY_API_BASE)) {
    return displayUrl.replace(DISPLAY_API_BASE, REAL_API_BASE);
  }
  return displayUrl;
}

/**
 * Mask an API endpoint path for display in UI components.
 * Returns a display-friendly URL string.
 */
export function displayEndpoint(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${DISPLAY_API_BASE}${cleanPath}`;
}
