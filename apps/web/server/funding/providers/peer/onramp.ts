import "server-only";

// Intentionally no peer.onramp port. Issue #436 forbids undocumented hosted
// parameters or a generic redirect until Peer confirms a stable integration
// contract that pins Home's recipient, Base USDC, amount, country, and recovery.
export const peerOnramp = undefined;
