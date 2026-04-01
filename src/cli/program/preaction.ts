import type { Command } from "commander";
import { resolveCliName } from "../cli-name.js";

function setProcessTitleForCommand(actionCommand: Command) {
  let current: Command = actionCommand;
  while (current.parent && current.parent.parent) {
    current = current.parent;
  }
  const name = current.name();
  const cliName = resolveCliName();
  if (!name || name === cliName) {
    return;
  }
  process.title = `${cliName}-${name}`;
}

export function registerPreActionHooks(program: Command, programVersion: string) {
  void programVersion;
  program.hook("preAction", (_thisCommand, actionCommand) => {
    setProcessTitleForCommand(actionCommand);
  });
}
