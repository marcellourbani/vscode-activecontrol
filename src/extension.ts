// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
  window,
  workspace,
  ExtensionContext,
  extensions,
  commands,
  Uri,
  EventEmitter,
  ProgressLocation,
} from "vscode"
import { parse } from "fast-xml-parser"
import * as opn from "open"
// import  { createProxyServer, createProxy },* as Server from "http-proxy"
import * as Server from "http-proxy"
import { ServerResponse } from "http"

type TransportValidator = (
  transport: string,
  type: string,
  name: string,
  devClass: string
) => Promise<boolean>

interface AbapFsApi {
  registerTransportValidator: (v: TransportValidator) => void
}

const formCreated = new EventEmitter<string>()
let target = ""
let port = ""
let server: Server | undefined

function isString(x: any): x is string {
  return typeof x === "string"
}

const parseForm = (xml: string) => {
  const raw = parse(xml)?.["asx:abap"]?.["asx:values"]?.TRANSPORT
  const { TRKORR, BTI_ERROR_MSG } = raw
  const {
    BTIEM_MSGTYP,
    BTIEM_TITLE,
    BTIEM_MESSAGE,
    BTIEM_OVERRIDES,
    BTIEM_EXCEPTION,
    BTIEM_GUID,
    BTIEM_IN_PROGRESS,
  } = BTI_ERROR_MSG

  if (TRKORR || BTIEM_MSGTYP)
    return {
      TRKORR,
      BTI_ERROR_MSG: {
        BTIEM_MSGTYP,
        BTIEM_TITLE,
        BTIEM_MESSAGE,
        BTIEM_OVERRIDES,
        BTIEM_EXCEPTION,
        BTIEM_GUID,
        BTIEM_IN_PROGRESS,
      },
    }
}

const urlAction = (url: string) => {
  const hit = Uri.parse(url)
    .query.split("&")
    .map(c => c.split("="))
    .find(c => c[0].toUpperCase() === "ACTION")
  return hit && hit[1]
}

const responseContents = (res: ServerResponse) =>
  new Promise<string>(resolve => {
    const chunks: any[] = []
    res.on("pipe", rs =>
      rs
        .on("data", chunk => chunks.push(chunk))
        .on("close", () => resolve(Buffer.from(chunks.join()).toString()))
    )
  })

const createServerIfNeeded = () => {
  if (server) return
  if (!target || !port || !isString(target)) return
  const proxy = Server.createProxyServer({ target })
  proxy.on("proxyRes", async (preq, req, res) => {
    if (res && req.method === "POST" && req.url) {
      const action = urlAction(req.url)
      if (action === "SAVEREQUESTDETAIL") {
        const body = await responseContents(res)
        const result = parseForm(body)
        const mt = result?.BTI_ERROR_MSG.BTIEM_MSGTYP
        if (result?.TRKORR && mt !== "E" && mt !== "W")
          formCreated.fire(result.TRKORR)
      }
    }
  })
  server = proxy.listen(9000)
}

async function createTF(transport: string) {
  createServerIfNeeded()
  if (!server) return true

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: `Creating transport form for ${transport}`,
    },
    progress =>
      new Promise<boolean>(async resolve => {
        const sub = formCreated.event(form => {
          if (form === transport) resolve(true)
          else resolve(false)
          sub.dispose()
        })
        await opn(
          `http://localhost:${port}/sap/bc/bsp/bti/te_bsp_new/main.html#transportform/create`
        )
      })
  )
}

export async function activate(context: ExtensionContext) {
  target = workspace.getConfiguration().get("activecontrol.url") as string
  port = workspace.getConfiguration().get("activecontrol.port") as string
  const ext = extensions.getExtension<AbapFsApi>(
    "murbani.vscode-abap-remote-fs"
  )
  if (!ext) return
  if (!ext.isActive) await ext.activate()
  ext.exports.registerTransportValidator(createTF)
  context.subscriptions.push(
    commands.registerCommand("activecontrol.createform", createTF)
  )
}

// this method is called when your extension is deactivated
export function deactivate() {
  return new Promise(resolve => server && server.close(() => resolve()))
}
