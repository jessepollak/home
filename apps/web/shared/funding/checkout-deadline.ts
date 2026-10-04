export const CHECKOUT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export function checkoutDeadline(order: { expiresAt: string | null; createdAt: string }): number {
  const createdAt = Date.parse(order.createdAt);
  const providerExpiry = order.expiresAt === null ? Number.NaN : Date.parse(order.expiresAt);
  return Number.isFinite(providerExpiry) && providerExpiry > createdAt ? providerExpiry : createdAt + CHECKOUT_STALE_AFTER_MS;
}
