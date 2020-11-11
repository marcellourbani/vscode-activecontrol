import { window, workspace } from "vscode"

interface RawConfiguration {
  url: string
  port: string
  user: string
  transportfilters: string[]
}
interface Configuration {
  url: string
  port: number
  user: string
  filters: RegExp[]
}
const toRegExp = (s: string) => {
  try {
    return new RegExp(s)
  } catch (error) {
  }
}

const parsePort = (p: string) => {
  const port = Number.parseInt(p)
  return Number.isInteger(port) ? port : 9000
}

export function config(): Configuration {
  const config = workspace.getConfiguration().get("activecontrol") || {}
  const { url = "", port: portstr = "9000", user = "", transportfilters = [] } = config as Partial<RawConfiguration>
  const port = parsePort(portstr)
  const filters = transportfilters.map(toRegExp).filter((r): r is RegExp => !!r)
  if (filters.length < transportfilters.length) window.showWarningMessage(
    "Invalid regular expressions in transport patterns - ActiveControl will ignore bad ones")
  return { url, port, user, filters }
}
