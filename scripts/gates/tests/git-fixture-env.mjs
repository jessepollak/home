export function gitFixtureEnv(callerEnv = process.env) {
  return {
    ...Object.fromEntries(Object.entries(callerEnv).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
  };
}

export function applyGitFixtureEnv(callerEnv = process.env) {
  for (const name of Object.keys(callerEnv)) if (name.startsWith("GIT_")) delete callerEnv[name];
  Object.assign(callerEnv, gitFixtureEnv(callerEnv));
}
