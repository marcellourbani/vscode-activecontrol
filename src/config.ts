import { workspace } from "vscode"

interface Configuration {
  url: string
  port: string
  user: string
}

export function config(): Configuration {
  const url = workspace.getConfiguration().get("activecontrol.url") as string
  const port = workspace.getConfiguration().get("activecontrol.port") as string
  const { user = "" } = workspace.getConfiguration().get("activecontrol") || {}
  return { url, port, user }
}
