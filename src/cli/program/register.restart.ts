import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { restartWebRuntimeCommand } from "../web-runtime-command.js";

export function registerRestartCommand(program: Command) {
  program
    .command("restart")
    .description("Restart Useful managed web runtime (stop then start)")
    .option("--profile <name>", "Compatibility flag; non-useful values are ignored with a warning")
    .option("--web-port <port>", "Web runtime port override")
    .option("--no-open", "Do not open the browser automatically")
    .option("--skip-daemon-install", "Skip gateway daemon/service management (for containers or environments without systemd/launchd)", false)
    .option("--json", "Output summary as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await restartWebRuntimeCommand({
          profile: opts.profile as string | undefined,
          webPort: opts.webPort as string | undefined,
          noOpen: Boolean(opts.open === false),
          skipDaemonInstall: Boolean(opts.skipDaemonInstall),
          json: Boolean(opts.json),
        });
      });
    });
}
