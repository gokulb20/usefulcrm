import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { updateWebRuntimeCommand } from "../web-runtime-command.js";

export function registerUpdateCommand(program: Command) {
  program
    .command("update")
    .description("Update Useful managed web runtime without onboarding")
    .option("--profile <name>", "Compatibility flag; non-useful values are ignored with a warning")
    .option("--web-port <port>", "Web runtime port override")
    .option("--non-interactive", "Fail instead of prompting for major-gate approval", false)
    .option("--yes", "Approve mandatory major-gate Hermes update", false)
    .option("--no-open", "Do not open the browser automatically")
    .option("--skip-daemon-install", "Skip gateway daemon/service management (for containers or environments without systemd/launchd)", false)
    .option("--json", "Output summary as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await updateWebRuntimeCommand({
          profile: opts.profile as string | undefined,
          webPort: opts.webPort as string | undefined,
          nonInteractive: Boolean(opts.nonInteractive),
          yes: Boolean(opts.yes),
          noOpen: Boolean(opts.open === false),
          skipDaemonInstall: Boolean(opts.skipDaemonInstall),
          json: Boolean(opts.json),
        });
      });
    });
}
