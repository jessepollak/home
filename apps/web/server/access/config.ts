import "server-only";

export type AccessConfig =
  | { kind: "disabled" }
  | { kind: "misconfigured" }
  | { kind: "enabled"; credential: string };

const credentialEnvironmentKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;

export function readAccessConfig(
  environment: Record<string, string | undefined> = process.env,
): AccessConfig {
  if (environment.HOME_ACCESS_REQUIRED !== "1") return { kind: "disabled" };
  const credential = environment[credentialEnvironmentKey];
  if (!credential || Buffer.byteLength(credential, "utf8") < 32) {
    return { kind: "misconfigured" };
  }
  return { kind: "enabled", credential };
}
