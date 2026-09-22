Kept half of finalize.
Re-enable by replacing the `Hosted trades are unavailable.` throw in the `trade` branch of `server/actions/prepare.ts` and restoring the Permit2 preparation seam the dead-code gate removed: `validatePermit2`, `createPermit2StateReader`, `nonceBitmapPosition`, and `PERMIT2_ADDRESS`, all recoverable from this directory's history.
Permit2 signing and confirmation remain isolated here.
