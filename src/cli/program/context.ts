import { VERSION } from "../../version.js";

export type ProgramContext = {
  programVersion: string;
  channelOptions: string[];
  messageChannelOptions: string;
  agentChannelOptions: string;
};

export function createProgramContext(): ProgramContext {
  // Bootstrap-only CLI path does not register channel commands, so avoid loading
  // the full channel/plugin registry here.
  const channelOptions = ["web"];
  return {
    programVersion: VERSION,
    channelOptions,
    messageChannelOptions: channelOptions.join("|"),
    agentChannelOptions: ["last", ...channelOptions].join("|"),
  };
}
