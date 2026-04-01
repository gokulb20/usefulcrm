import { describe, expect, it } from "vitest";
import { shouldSkipRespawnForArgv } from "./respawn-policy.js";

describe("shouldSkipRespawnForArgv", () => {
  it("skips respawn for help/version invocations", () => {
    expect(shouldSkipRespawnForArgv(["node", "usefulcrm", "--help"])).toBe(true);
    expect(shouldSkipRespawnForArgv(["node", "usefulcrm", "-V"])).toBe(true);
  });

  it("does not skip respawn for normal command execution", () => {
    expect(shouldSkipRespawnForArgv(["node", "usefulcrm", "chat", "send"])).toBe(false);
  });
});
