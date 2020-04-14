import { getServer, onFormCreated } from "./proxy"
import { window, ProgressLocation } from "vscode"
import { config } from "./config"
import * as opn from "open"

async function createTF(transport: string) {
  const server = getServer()
  if (!server) return true
  const { port } = config()

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: `Creating transport form for ${transport}`,
    },
    progress =>
      new Promise<boolean>(async resolve => {
        const sub = onFormCreated(form => {
          if (form === transport) resolve(true)
          else resolve(false)
          sub.dispose()
        })
        await opn(
          `http://localhost:${port}/sap/bc/bsp/bti/te_bsp_new/main.html#transportform/create/trkorr=${transport}`
        )
      })
  )
}

export async function createFormCmd() {
  const transport = await window.showInputBox({
    prompt: "Enter transport number",
    ignoreFocusOut: true,
    validateInput: v => {
      if (!v.match(/[a-z]\w\wK\w\w\w\w\w\w/i)) return "Invalid transport number"
    },
  })
  if (transport) return createTF(transport)
}

export async function createFormIfMissing(transport: string) {
  return createTF(transport)
}
