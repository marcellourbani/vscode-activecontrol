// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { ExtensionContext, extensions, commands } from "vscode"
import { close } from "./proxy"
import { AbapFsApi } from "./api"
import { createFormCmd, createFormIfMissing } from "./transportForm"

export async function activate(context: ExtensionContext) {
  const ext = extensions.getExtension<AbapFsApi>(
    "murbani.vscode-abap-remote-fs"
  )
  if (!ext) return
  if (!ext.isActive) await ext.activate()
  ext.exports.registerTransportValidator(createFormIfMissing)
  context.subscriptions.push(
    commands.registerCommand("activecontrol.createform", createFormCmd)
  )
}

// this method is called when your extension is deactivated
export function deactivate() {
  return close()
}
