export type SetupVariable = { name: string; state: "set" | "unset" | "invalid" };
export type SetupState = "ready" | "missing" | "invalid" | "unavailable" | "needs-migration";
export type SetupStep = {
  id: string;
  title: string;
  state: SetupState;
  variables: SetupVariable[];
  detail: string;
  documentationHref: string;
};
export type RunningBuild =
  | { kind: "deployment"; commit: string; branch: string | null; deploymentId: string | null; environment: string | null }
  | { kind: "unavailable" };
export type OperatorSetup = { required: SetupStep[]; optional: SetupStep[]; requiredStepsLeft: number; build: RunningBuild };
