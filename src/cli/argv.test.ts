import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getCommandPath,
  getFlagValue,
  getPositiveIntFlagValue,
  getPrimaryCommand,
  hasHelpOrVersion,
  hasRootVersionAlias,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags and root -v alias only in root-flag contexts", () => {
    expect(hasHelpOrVersion(["node", "usefulcrm", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "usefulcrm", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "usefulcrm", "-v"])).toBe(true);
    expect(hasRootVersionAlias(["node", "usefulcrm", "-v", "chat"])).toBe(false);
  });

  it("extracts flag values across --name value and --name=value forms", () => {
    expect(getFlagValue(["node", "usefulcrm", "--profile", "dev"], "--profile")).toBe("dev");
    expect(getFlagValue(["node", "usefulcrm", "--profile=team-a"], "--profile")).toBe("team-a");
    expect(getFlagValue(["node", "usefulcrm", "--profile", "--verbose"], "--profile")).toBeNull();
    expect(getFlagValue(["node", "usefulcrm", "--profile="], "--profile")).toBeNull();
  });

  it("parses positive integer flags and rejects invalid numeric values", () => {
    expect(getPositiveIntFlagValue(["node", "usefulcrm", "--port", "19001"], "--port")).toBe(19001);
    expect(getPositiveIntFlagValue(["node", "usefulcrm", "--port", "0"], "--port")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "usefulcrm", "--port", "-1"], "--port"),
    ).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "usefulcrm", "--port", "abc"], "--port"),
    ).toBeUndefined();
  });

  it("derives command path while skipping leading flags and stopping at terminator", () => {
    // Low-level parser skips flag tokens but not their values.
    expect(getCommandPath(["node", "usefulcrm", "--profile", "dev", "chat"], 2)).toEqual([
      "dev",
      "chat",
    ]);
    expect(getCommandPath(["node", "usefulcrm", "config", "get"], 2)).toEqual(["config", "get"]);
    expect(getCommandPath(["node", "usefulcrm", "--", "chat", "send"], 2)).toEqual([]);
    expect(getPrimaryCommand(["node", "usefulcrm", "--verbose", "status"])).toBe("status");
  });

  it("builds parse argv consistently across runtime invocation styles", () => {
    expect(
      buildParseArgv({
        programName: "usefulcrm",
        rawArgs: ["node", "cli.js", "status"],
      }),
    ).toEqual(["node", "cli.js", "status"]);

    expect(
      buildParseArgv({
        programName: "usefulcrm",
        rawArgs: ["usefulcrm", "status"],
      }),
    ).toEqual(["node", "usefulcrm", "status"]);

    expect(
      buildParseArgv({
        programName: "usefulcrm",
        rawArgs: ["node-22.12.0.exe", "cli.js", "agent", "run"],
      }),
    ).toEqual(["node-22.12.0.exe", "cli.js", "agent", "run"]);

    expect(
      buildParseArgv({
        programName: "usefulcrm",
        rawArgs: ["bun", "cli.ts", "status"],
      }),
    ).toEqual(["bun", "cli.ts", "status"]);
  });

  it("skips state migration for read-only command paths and keeps mutations enabled for others", () => {
    expect(shouldMigrateStateFromPath([])).toBe(true);
    expect(shouldMigrateStateFromPath(["health"])).toBe(false);
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["sessions"])).toBe(false);
    expect(shouldMigrateStateFromPath(["config", "get"])).toBe(false);
    expect(shouldMigrateStateFromPath(["models", "list"])).toBe(false);
    expect(shouldMigrateStateFromPath(["memory", "status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agent"])).toBe(false);
    expect(shouldMigrateStateFromPath(["chat", "send"])).toBe(true);

    expect(shouldMigrateState(["node", "usefulcrm", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "usefulcrm", "chat", "send"])).toBe(true);
  });
});
