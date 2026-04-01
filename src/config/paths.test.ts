import { describe, it, expect } from "vitest";
import {
  isDaemonlessMode,
  resolveGatewayPort,
  DEFAULT_GATEWAY_PORT,
  DENCHCLAW_DEFAULT_GATEWAY_PORT,
} from "./paths.js";

describe("resolveGatewayPort", () => {
  it("returns UsefulCRM port when profile is useful and no config/env override (prevents Hermes port hijack)", () => {
    const port = resolveGatewayPort(undefined, { OPENCLAW_PROFILE: "useful" });
    expect(port).toBe(19001);
    expect(port).not.toBe(DEFAULT_GATEWAY_PORT);
  });

  it("returns Hermes default when no profile is set (preserves host gateway default)", () => {
    expect(resolveGatewayPort(undefined, {})).toBe(18789);
  });

  it("env OPENCLAW_GATEWAY_PORT overrides profile-based default (supports runtime override)", () => {
    expect(
      resolveGatewayPort(undefined, {
        OPENCLAW_PROFILE: "useful",
        OPENCLAW_GATEWAY_PORT: "19500",
      }),
    ).toBe(19500);
  });

  it("legacy env CLAWDBOT_GATEWAY_PORT is still honoured (backwards compatibility)", () => {
    expect(
      resolveGatewayPort(undefined, { CLAWDBOT_GATEWAY_PORT: "19500" }),
    ).toBe(19500);
  });

  it("config port overrides profile-based default (honours persisted config)", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19005 } },
        { OPENCLAW_PROFILE: "useful" },
      ),
    ).toBe(19005);
  });

  it("env var takes precedence over config port (explicit runtime override wins)", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19005 } },
        { OPENCLAW_GATEWAY_PORT: "19500" },
      ),
    ).toBe(19500);
  });

  it("ignores non-numeric env values and falls through to profile default (malformed input)", () => {
    expect(
      resolveGatewayPort(undefined, {
        OPENCLAW_PROFILE: "useful",
        OPENCLAW_GATEWAY_PORT: "not-a-number",
      }),
    ).toBe(DENCHCLAW_DEFAULT_GATEWAY_PORT);
  });

  it("ignores zero and negative config ports (invalid config)", () => {
    expect(resolveGatewayPort({ gateway: { port: 0 } }, { OPENCLAW_PROFILE: "useful" })).toBe(
      DENCHCLAW_DEFAULT_GATEWAY_PORT,
    );
    expect(resolveGatewayPort({ gateway: { port: -1 } }, { OPENCLAW_PROFILE: "useful" })).toBe(
      DENCHCLAW_DEFAULT_GATEWAY_PORT,
    );
  });

  it("treats whitespace-only env as absent (trims before parsing)", () => {
    expect(
      resolveGatewayPort(undefined, {
        OPENCLAW_PROFILE: "useful",
        OPENCLAW_GATEWAY_PORT: "   ",
      }),
    ).toBe(DENCHCLAW_DEFAULT_GATEWAY_PORT);
  });

  it("undefined config falls through to profile/global default", () => {
    expect(resolveGatewayPort(undefined, {})).toBe(DEFAULT_GATEWAY_PORT);
    expect(resolveGatewayPort({}, {})).toBe(DEFAULT_GATEWAY_PORT);
    expect(resolveGatewayPort({ gateway: {} }, { OPENCLAW_PROFILE: "useful" })).toBe(
      DENCHCLAW_DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("isDaemonlessMode", () => {
  it("returns false when no opt and no env var", () => {
    expect(isDaemonlessMode(undefined, {})).toBe(false);
    expect(isDaemonlessMode({}, {})).toBe(false);
  });

  it("returns true when opts.skipDaemonInstall is set", () => {
    expect(isDaemonlessMode({ skipDaemonInstall: true }, {})).toBe(true);
  });

  it("returns true when DENCHCLAW_DAEMONLESS=1 env var is set", () => {
    expect(isDaemonlessMode(undefined, { DENCHCLAW_DAEMONLESS: "1" })).toBe(true);
    expect(isDaemonlessMode({}, { DENCHCLAW_DAEMONLESS: "1" })).toBe(true);
  });

  it("returns false for non-'1' env values", () => {
    expect(isDaemonlessMode(undefined, { DENCHCLAW_DAEMONLESS: "true" })).toBe(false);
    expect(isDaemonlessMode(undefined, { DENCHCLAW_DAEMONLESS: "yes" })).toBe(false);
    expect(isDaemonlessMode(undefined, { DENCHCLAW_DAEMONLESS: "0" })).toBe(false);
  });

  it("opts.skipDaemonInstall=true wins even without env var", () => {
    expect(isDaemonlessMode({ skipDaemonInstall: true }, { DENCHCLAW_DAEMONLESS: "0" })).toBe(true);
  });
});

describe("port constants", () => {
  it("UsefulCRM default port is distinct from Hermes default (prevents port collision)", () => {
    expect(DENCHCLAW_DEFAULT_GATEWAY_PORT).not.toBe(DEFAULT_GATEWAY_PORT);
    expect(DENCHCLAW_DEFAULT_GATEWAY_PORT).toBe(19001);
    expect(DEFAULT_GATEWAY_PORT).toBe(18789);
  });
});
