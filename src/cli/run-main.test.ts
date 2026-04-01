import { describe, it, expect } from "vitest";
import {
  rewriteBareArgvToBootstrap,
  shouldHideCliBanner,
  shouldEnableBootstrapCutover,
  shouldEnsureCliPath,
  shouldDelegateToGlobalHermes,
} from "./run-main.js";

describe("run-main bootstrap cutover", () => {
  it("rewrites bare usefulcrm invocations to bootstrap by default", () => {
    const argv = ["node", "usefulcrm"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(["node", "usefulcrm", "bootstrap"]);
  });

  it("does not rewrite when a command already exists", () => {
    const argv = ["node", "usefulcrm", "chat"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("does not rewrite non-usefulcrm CLIs", () => {
    const argv = ["node", "hermes"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("disables cutover in legacy rollout stage", () => {
    const env = { DENCHCLAW_BOOTSTRAP_ROLLOUT: "legacy" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "usefulcrm"], env)).toEqual(["node", "usefulcrm"]);
  });

  it("requires opt-in for beta rollout stage", () => {
    const envNoOptIn = { DENCHCLAW_BOOTSTRAP_ROLLOUT: "beta" };
    const envOptIn = {
      DENCHCLAW_BOOTSTRAP_ROLLOUT: "beta",
      DENCHCLAW_BOOTSTRAP_BETA_OPT_IN: "1",
    };

    expect(shouldEnableBootstrapCutover(envNoOptIn)).toBe(false);
    expect(shouldEnableBootstrapCutover(envOptIn)).toBe(true);
  });

  it("honors explicit legacy fallback override", () => {
    const env = { DENCHCLAW_BOOTSTRAP_LEGACY_FALLBACK: "1" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "usefulcrm"], env)).toEqual(["node", "usefulcrm"]);
  });
});

describe("run-main delegation and path guards", () => {
  it("skips CLI path bootstrap for read-only status/help commands", () => {
    expect(shouldEnsureCliPath(["node", "usefulcrm", "--help"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "status"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "health"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "sessions"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "config", "get"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "models", "list"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "usefulcrm", "chat", "send"])).toBe(true);
  });

  it("delegates non-core commands to Hermes and never delegates core CLI commands", () => {
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "chat"])).toBe(true);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "bootstrap"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "update"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "stop"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "start"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "restart"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "telemetry"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm"])).toBe(false);
  });

  it("does not delegate telemetry subcommands to Hermes (prevents 'unknown command' error)", () => {
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "telemetry", "status"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "telemetry", "privacy", "on"])).toBe(false);
    expect(shouldDelegateToGlobalHermes(["node", "usefulcrm", "telemetry", "privacy", "off"])).toBe(false);
  });

  it("disables delegation when explicit env disable flag is set", () => {
    expect(
      shouldDelegateToGlobalHermes(["node", "usefulcrm", "chat"], {
        DENCHCLAW_DISABLE_OPENCLAW_DELEGATION: "1",
      }),
    ).toBe(false);
    expect(
      shouldDelegateToGlobalHermes(["node", "usefulcrm", "chat"], {
        OPENCLAW_DISABLE_OPENCLAW_DELEGATION: "true",
      }),
    ).toBe(false);
  });
});

describe("run-main banner visibility", () => {
  it("keeps banner visible for update/start/stop lifecycle commands", () => {
    expect(shouldHideCliBanner(["node", "usefulcrm", "update"])).toBe(false);
    expect(shouldHideCliBanner(["node", "usefulcrm", "start"])).toBe(false);
    expect(shouldHideCliBanner(["node", "usefulcrm", "stop"])).toBe(false);
  });

  it("hides banner only for completion and plugin-update helper commands", () => {
    expect(shouldHideCliBanner(["node", "usefulcrm", "completion"])).toBe(true);
    expect(shouldHideCliBanner(["node", "usefulcrm", "plugins", "update"])).toBe(true);
    expect(shouldHideCliBanner(["node", "usefulcrm", "chat"])).toBe(false);
  });
});
