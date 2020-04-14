import { workspace } from "vscode"

interface Configuration {
  url: string
  port: string
}

export function config(): Configuration {
  const url = workspace.getConfiguration().get("activecontrol.url") as string
  const port = workspace.getConfiguration().get("activecontrol.port") as string
  const foo = workspace.getConfiguration().get("activecontrol")
  console.log(foo)
  return { url, port }
}
