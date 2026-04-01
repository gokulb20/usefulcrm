const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

function parseNodeVersion(version: string): { major: number; minor: number } {
  const [majorRaw = "0", minorRaw = "0"] = version.split(".");
  return {
    major: Number.parseInt(majorRaw, 10) || 0,
    minor: Number.parseInt(minorRaw, 10) || 0,
  };
}

export function assertSupportedRuntime(): void {
  const { major, minor } = parseNodeVersion(process.versions.node);
  const unsupported =
    major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR);
  if (unsupported) {
    throw new Error(
      `UsefulCRM requires Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+ (current: ${process.versions.node}).`,
    );
  }
}
