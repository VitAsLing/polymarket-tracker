/**
 * Formatting utility functions
 */

export function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

export function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '$0.00';
  const num = Number(amount);
  if (isNaN(num)) return '$0.00';
  const sign = num >= 0 ? '' : '-';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0.0%';
  const num = Number(value) * 100;
  if (isNaN(num)) return '0.0%';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[_*`\[]/g, '\\$&');
}

/**
 * Get magnitude emoji based on amount (💰 count)
 */
export function getMagnitude(amount: number): string {
  const abs = Math.abs(amount);
  if (abs < 100) return '💰';
  if (abs < 1000) return '💰💰';
  if (abs < 10000) return '💰💰💰';
  if (abs < 100000) return '💰💰💰💰';
  return '💰💰💰💰💰';
}

/**
 * Format PnL with direction emoji and magnitude
 * e.g. 🟢 *+$5,000* 💰💰💰
 * Magnitude at the end for better alignment
 */
export function formatPnL(amount: number, includePercent?: number): string {
  const emoji = amount >= 0 ? '🟢' : '🔴';
  const magnitude = getMagnitude(amount);
  const sign = amount >= 0 ? '+' : '';
  const formatted = `${sign}${formatUSD(amount)}`;

  if (includePercent !== undefined) {
    const pctSign = includePercent >= 0 ? '+' : '';
    return `${emoji} *${formatted} (${pctSign}${(includePercent * 100).toFixed(1)}%)* ${magnitude}`;
  }
  return `${emoji} *${formatted}* ${magnitude}`;
}
