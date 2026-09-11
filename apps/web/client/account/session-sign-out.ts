export type SessionSuppression = {
  ownerKey: string;
  generation: number;
};

export function isSessionSuppressedForOwner(
  suppression: SessionSuppression | null,
  currentOwnerKey: string | null,
  currentGeneration: number,
): boolean {
  return Boolean(
    suppression &&
      suppression.ownerKey === currentOwnerKey &&
      suppression.generation === currentGeneration,
  );
}

export async function signOutWithSessionSuppressed({
  ownerKey,
  generation,
  signOut,
  suppress,
  onFailure,
}: {
  ownerKey: string;
  generation: number;
  signOut: () => Promise<void>;
  suppress: (suppression: SessionSuppression) => void;
  onFailure: () => void;
}): Promise<boolean> {
  suppress({ ownerKey, generation });

  try {
    await signOut();
    return true;
  } catch {
    onFailure();
    return false;
  }
}
