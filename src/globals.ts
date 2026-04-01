let verboseEnabled = false;
let yesEnabled = false;

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function setVerbose(enabled: boolean): void {
  verboseEnabled = Boolean(enabled);
}

export function isVerbose(): boolean {
  return (
    verboseEnabled ||
    isTruthyEnvValue(process.env.OPENCLAW_VERBOSE) ||
    isTruthyEnvValue(process.env.CLAWDBOT_VERBOSE)
  );
}

export function shouldLogVerbose(): boolean {
  return isVerbose();
}

export function setYes(enabled: boolean): void {
  yesEnabled = Boolean(enabled);
}

export function isYes(): boolean {
  return (
    yesEnabled ||
    isTruthyEnvValue(process.env.OPENCLAW_YES) ||
    isTruthyEnvValue(process.env.CLAWDBOT_YES)
  );
}

export function logVerbose(...args: unknown[]): void {
  if (shouldLogVerbose()) {
    console.error(...args);
  }
}

export function info(...args: unknown[]): void {
  console.log(...args);
}

export function warn(...args: unknown[]): void {
  console.warn(...args);
}

export function danger(...args: unknown[]): void {
  console.error(...args);
}
