/**
 * Global registry for active Useful App instances.
 * Enables inter-app messaging, tool discovery, and app listing.
 */

export type ToolDef = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export type AppInstance = {
  appName: string;
  iframe: HTMLIFrameElement;
  tools: Map<string, ToolDef>;
};

type AppMessageHandler = (event: {
  from: string;
  message: unknown;
}) => void;

const g = (typeof globalThis !== "undefined" ? globalThis : window) as unknown as {
  __usefulAppRegistry?: Map<string, Set<AppInstance>>;
  __usefulAppMessageHandlers?: Set<AppMessageHandler>;
};

if (!g.__usefulAppRegistry) g.__usefulAppRegistry = new Map();
if (!g.__usefulAppMessageHandlers) g.__usefulAppMessageHandlers = new Set();

const registry = g.__usefulAppRegistry;
const messageHandlers = g.__usefulAppMessageHandlers;

export function registerApp(instance: AppInstance): void {
  let instances = registry.get(instance.appName);
  if (!instances) {
    instances = new Set();
    registry.set(instance.appName, instances);
  }
  instances.add(instance);
}

export function unregisterApp(instance: AppInstance): void {
  const instances = registry.get(instance.appName);
  if (instances) {
    instances.delete(instance);
    if (instances.size === 0) registry.delete(instance.appName);
  }
}

export function sendToApp(
  targetApp: string,
  message: unknown,
  sourceApp: string,
): boolean {
  const instances = registry.get(targetApp);
  if (!instances || instances.size === 0) return false;

  for (const inst of instances) {
    inst.iframe.contentWindow?.postMessage(
      {
        type: "useful:event",
        channel: "apps.message",
        data: { from: sourceApp, message },
      },
      "*",
    );
  }
  return true;
}

export function listActiveApps(): Array<{
  name: string;
  instanceCount: number;
}> {
  const result: Array<{ name: string; instanceCount: number }> = [];
  for (const [name, instances] of registry) {
    result.push({ name, instanceCount: instances.size });
  }
  return result;
}

export function getAppTools(
  appName: string,
): ToolDef[] {
  const instances = registry.get(appName);
  if (!instances) return [];
  const tools: ToolDef[] = [];
  for (const inst of instances) {
    for (const tool of inst.tools.values()) {
      tools.push(tool);
    }
  }
  return tools;
}

export function getAllTools(): Array<ToolDef & { appName: string }> {
  const result: Array<ToolDef & { appName: string }> = [];
  for (const [appName, instances] of registry) {
    for (const inst of instances) {
      for (const tool of inst.tools.values()) {
        result.push({ ...tool, appName });
      }
    }
  }
  return result;
}

export function onAppMessage(handler: AppMessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function emitAppMessage(from: string, message: unknown): void {
  for (const handler of messageHandlers) {
    handler({ from, message });
  }
}
