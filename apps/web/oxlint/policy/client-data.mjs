// apps/web-relative exceptions for client GETs outside the query factories.
// Pass-through transports with unknown init stay allowed; opaque Request variables retain GET classification.
export const clientGetExceptions = new Set([]);

// Exact apps/web-relative exceptions for literal query keys outside the scope factories.
export const queryKeyExceptions = new Set([]);
