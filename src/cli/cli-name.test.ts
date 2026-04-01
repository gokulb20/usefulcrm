import { describe, expect, it } from "vitest";
import { DEFAULT_CLI_NAME, replaceCliName, resolveCliName } from "./cli-name.js";

describe("cli-name", () => {
  it("resolves known CLI names from argv[1]", () => {
    expect(resolveCliName(["node", "hermes"])).toBe("hermes");
    expect(resolveCliName(["node", "usefulcrm"])).toBe("usefulcrm");
    expect(resolveCliName(["node", "/usr/local/bin/hermes"])).toBe("hermes");
  });

  it("falls back to default name for unknown binaries", () => {
    expect(resolveCliName(["node", "custom-cli"])).toBe(DEFAULT_CLI_NAME);
  });

  it("replaces CLI name in command prefixes while preserving package runner prefix", () => {
    expect(replaceCliName("hermes status", "usefulcrm")).toBe("usefulcrm status");
    expect(replaceCliName("pnpm hermes status", "usefulcrm")).toBe("pnpm usefulcrm status");
    expect(replaceCliName("npx usefulcrm status", "hermes")).toBe("npx hermes status");
  });

  it("keeps command unchanged when it does not start with a known CLI prefix", () => {
    expect(replaceCliName("echo hermes status", "usefulcrm")).toBe("echo hermes status");
    expect(replaceCliName("   ", "hermes")).toBe("   ");
  });
});
