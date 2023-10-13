import { ExtensionContext, extensions, commands } from "vscode"
import { close } from "./proxy"
import { AbapFsApi } from "./api"
import { createFormCmd, createFormIfMissing } from "./transportForm"
import { PasswordVault } from "./externalmodules"

export async function activate(context: ExtensionContext) {
  const ext = extensions.getExtension<AbapFsApi>(
    "murbani.vscode-abap-remote-fs"
  )
  if (!ext) return
  if (!ext.isActive) await ext.activate()
  PasswordVault.get(context)
  ext.exports.registerTransportValidator(createFormIfMissing)
  context.subscriptions.push(
    commands.registerCommand("activecontrol.createform", createFormCmd)
  )
}

export function deactivate() {
  return close()
}
