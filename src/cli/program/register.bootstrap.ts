import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { bootstrapCommand } from "../bootstrap.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerBootstrapCommand(program: Command) {
  program
    .command("bootstrap")
    .description("Bootstrap UsefulCRM on top of Hermes and open the web UI")
    .option("--profile <name>", "Compatibility flag; non-useful values are ignored with a warning")
    .option("--force-onboard", "Run onboarding even if config already exists", false)
    .option("--non-interactive", "Skip prompts where possible", false)
    .option("--yes", "Auto-approve install prompts", false)
    .option("--skip-update", "Skip update prompt/check", false)
    .option("--update-now", "Run Hermes update before onboarding", false)
    .option("--gateway-port <port>", "Gateway port override for first-run onboarding")
    .option("--web-port <port>", "Preferred web UI port (default: 3100)")
    .option("--useful-cloud", "Configure Useful Cloud and skip Hermes provider onboarding", false)
    .option("--useful-cloud-api-key <key>", "Useful Cloud API key for bootstrap-driven setup")
    .option("--useful-cloud-model <id>", "Stable or public Useful Cloud model id to use as default")
    .option("--useful-gateway-url <url>", "Override the Useful Cloud gateway base URL")
    .option("--skip-daemon-install", "Skip gateway daemon/service installation (for containers or environments without systemd/launchd)", false)
    .option("--no-open", "Do not open the browser automatically")
    .option("--json", "Output summary as JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/onboard", "docs.hermes.ai/cli/onboard")}\n`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await bootstrapCommand({
          profile: opts.profile as string | undefined,
          forceOnboard: Boolean(opts.forceOnboard),
          nonInteractive: Boolean(opts.nonInteractive),
          yes: Boolean(opts.yes),
          skipUpdate: Boolean(opts.skipUpdate),
          updateNow: Boolean(opts.updateNow),
          gatewayPort: opts.gatewayPort as string | undefined,
          webPort: opts.webPort as string | undefined,
          usefulCloud: opts.usefulCloud ? true : undefined,
          usefulCloudApiKey: opts.usefulCloudApiKey as string | undefined,
          usefulCloudModel: opts.usefulCloudModel as string | undefined,
          usefulGatewayUrl: opts.usefulGatewayUrl as string | undefined,
          skipDaemonInstall: Boolean(opts.skipDaemonInstall),
          noOpen: Boolean(opts.open === false),
          json: Boolean(opts.json),
        });
      });
    });
}
