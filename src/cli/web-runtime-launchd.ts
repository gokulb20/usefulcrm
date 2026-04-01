import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  resolveManagedWebRuntimeServerPath,
  updateManifestLastPort,
  writeManagedWebRuntimeProcess,
  type StartManagedWebRuntimeResult,
} from "./web-runtime.js";

const LAUNCH_AGENT_LABEL = "ai.usefulcrm.web-runtime";

export function resolveLaunchAgentPlistPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LAUNCH_AGENT_LABEL}.plist`,
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPlistXml(params: {
  nodePath: string;
  serverPath: string;
  workingDirectory: string;
  port: number;
  gatewayPort: number;
  stdoutPath: string;
  stderrPath: string;
}): string {
  const nodeDir = path.dirname(params.nodePath);
  const envPath = [nodeDir, "/usr/local/bin", "/usr/bin", "/bin"]
    .filter((seg, i, arr) => arr.indexOf(seg) === i)
    .join(":");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${escapeXml(LAUNCH_AGENT_LABEL)}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${escapeXml(params.nodePath)}</string>`,
    `    <string>${escapeXml(params.serverPath)}</string>`,
    `  </array>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${escapeXml(params.workingDirectory)}</string>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>PORT</key>`,
    `    <string>${params.port}</string>`,
    `    <key>HOSTNAME</key>`,
    `    <string>127.0.0.1</string>`,
    `    <key>OPENCLAW_GATEWAY_PORT</key>`,
    `    <string>${params.gatewayPort}</string>`,
    `    <key>NODE_ENV</key>`,
    `    <string>production</string>`,
    `    <key>PATH</key>`,
    `    <string>${escapeXml(envPath)}</string>`,
    `  </dict>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${escapeXml(params.stdoutPath)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${escapeXml(params.stderrPath)}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

export function isWebRuntimeLaunchAgentLoaded(): boolean {
  try {
    execFileSync("launchctl", ["list", LAUNCH_AGENT_LABEL], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function resolveLaunchAgentPid(): number | null {
  try {
    const output = execFileSync("launchctl", ["list", LAUNCH_AGENT_LABEL], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const match = output.match(/"PID"\s*=\s*(\d+)/);
    if (match?.[1]) {
      const pid = Number.parseInt(match[1], 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
    return null;
  } catch {
    return null;
  }
}

export function uninstallWebRuntimeLaunchAgent(): void {
  const plistPath = resolveLaunchAgentPlistPath();

  if (isWebRuntimeLaunchAgentLoaded()) {
    try {
      execFileSync("launchctl", ["unload", "-w", plistPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      try {
        execFileSync("launchctl", ["remove", LAUNCH_AGENT_LABEL], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        // best-effort
      }
    }
  }

  rmSync(plistPath, { force: true });
}

/**
 * Install a macOS LaunchAgent for the web runtime so it auto-starts on login.
 * Writes the plist to ~/Library/LaunchAgents/ and loads it via launchctl.
 * RunAtLoad causes launchd to start the process immediately on load.
 */
export function installWebRuntimeLaunchAgent(params: {
  stateDir: string;
  port: number;
  gatewayPort: number;
}): StartManagedWebRuntimeResult {
  const runtimeServerPath = resolveManagedWebRuntimeServerPath(params.stateDir);
  if (!existsSync(runtimeServerPath)) {
    return { started: false, runtimeServerPath, reason: "runtime-missing" };
  }

  const appDir = path.dirname(runtimeServerPath);
  const logsDir = path.join(params.stateDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  uninstallWebRuntimeLaunchAgent();

  const plistPath = resolveLaunchAgentPlistPath();
  mkdirSync(path.dirname(plistPath), { recursive: true });

  const plistXml = buildPlistXml({
    nodePath: process.execPath,
    serverPath: runtimeServerPath,
    workingDirectory: appDir,
    port: params.port,
    gatewayPort: params.gatewayPort,
    stdoutPath: path.join(logsDir, "web-app.log"),
    stderrPath: path.join(logsDir, "web-app.err.log"),
  });

  writeFileSync(plistPath, plistXml, "utf-8");

  try {
    execFileSync("launchctl", ["load", "-w", plistPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    rmSync(plistPath, { force: true });
    return { started: false, runtimeServerPath, reason: "launchctl-load-failed" };
  }

  const pid = resolveLaunchAgentPid() ?? -1;

  writeManagedWebRuntimeProcess(params.stateDir, {
    pid,
    port: params.port,
    gatewayPort: params.gatewayPort,
    startedAt: new Date().toISOString(),
    runtimeAppDir: appDir,
  });
  updateManifestLastPort(params.stateDir, params.port, params.gatewayPort);

  return { started: true, pid, runtimeServerPath };
}
