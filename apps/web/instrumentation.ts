export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTerminalServer } = await import("./lib/terminal-server");
    startTerminalServer(Number(process.env.TERMINAL_WS_PORT) || 3101);

    const { startChatAgentGc } = await import("./lib/chat-agent-registry");
    startChatAgentGc();
  }
}
