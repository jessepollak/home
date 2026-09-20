import "server-only";

export type AccessConfig =
  | { kind: "disabled" }
  | { kind: "misconfigured" }
  | { kind: "enabled"; credential: string; signingSecret: string };

const credentialEnvironmentKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;
const signingSecretEnvironmentKey = "HOME_ACCESS_SIGNING_SECRET";

export function readAccessConfig(
  environment: Record<string, string | undefined> = process.env,
): AccessConfig {
  if (environment.HOME_ACCESS_REQUIRED !== "1") return { kind: "disabled" };
  const credential = environment[credentialEnvironmentKey];
  const signingSecret = environment[signingSecretEnvironmentKey];
  if (
    !credential ||
    Buffer.byteLength(credential, "utf8") < 8 ||
    !signingSecret ||
    Buffer.byteLength(signingSecret, "utf8") < 32
  ) {
    return { kind: "misconfigured" };
  }
  return { kind: "enabled", credential, signingSecret };
}
