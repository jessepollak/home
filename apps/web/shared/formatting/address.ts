const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return addressPattern.test(value.trim());
}

/** App-wide address condensation: first 6 + ellipsis + last 6. */
export function formatAddress(value: string): string {
  const address = value.trim();
  if (!isAddress(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}
