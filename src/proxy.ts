import * as Server from "http-proxy"
import { parse } from "fast-xml-parser"
import { Uri, EventEmitter, workspace } from "vscode"
import { ServerResponse } from "http"
import { config } from "./config"
const formCreated = new EventEmitter<string>()
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

let server: Server | undefined

export const getServer = () => {
  if (server) return server

  const { url, port } = config()

  const proxy = Server.createProxyServer({ target: url })
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
  return server
}

export const onFormCreated = formCreated.event
export const close = () => new Promise(r => server && server.close(r))
