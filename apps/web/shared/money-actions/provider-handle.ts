export type ProviderHandle =
  | {
      kind: "user-operation-hash";
      provider: "cdp-embedded";
      value: `0x${string}`;
    }
  | { kind: "submission-id"; provider: "base-account"; value: string };
