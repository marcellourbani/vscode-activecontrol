import * as Server from "http-proxy"
import { Uri, EventEmitter } from "vscode"
import { ServerResponse } from "http"
import { config } from "./config"
import { parseForm } from "./transportForm"
import { unzipSync, inflateSync, brotliDecompressSync } from "zlib"
import { Stream } from "stream"
import { IncomingMessage } from "http"
const formCreated = new EventEmitter<string>()

const urlAction = (url: string) => {
  const hit = Uri.parse(url)
    .query.split("&")
    .map(c => c.split("="))
    .find(c => c[0].toUpperCase() === "ACTION")
  return hit && hit[1]
}

const streamContents = (res: Stream, ce: string) =>
  new Promise<string>(resolve => {
    const chunks: any[] = []
    const resolver = (rs: Stream) =>
      rs
        .on("data", chunk => chunks.push(chunk))
        .on("close", () => {
          const raw = Buffer.concat(chunks)
          switch (ce) {
            case "gzip":
              resolve(unzipSync(raw).toString())
              break
            case "br":
              resolve(brotliDecompressSync(raw).toString())
              break
            case "deflate":
              resolve(inflateSync(raw).toString())
              break
            default:
              resolve(raw.toString())
          }
        })
    resolver(res)
  })

const responseContents = (res: Stream, ce: string) =>
  new Promise<string>(resolve =>
    res.on("pipe", r => streamContents(r, ce).then(resolve))
  )
const ctype = (im: IncomingMessage) => im.headers["content-encoding"] || ""

let server: Server | undefined

const isFormCreate = (req: IncomingMessage) =>
  req.method === "POST" && !!req.url?.match(/\/api\/forms[^/]*$/)

const requestBodies = new WeakMap<Object, Promise<string>>()

const formWasCreated = async (
  preq: IncomingMessage,
  req: IncomingMessage,
  res: ServerResponse,
  newApi: boolean
) => {
  if (newApi) {
    if (res && isFormCreate(req)) {
      const body = await requestBodies.get(req)
      const parsed = JSON.parse(body || "")
      return parsed?.transportForm?.requestId
    }
  } else {
    if (res && req.method === "POST" && req.url) {
      const action = urlAction(req.url)
      if (action === "SAVEREQUESTDETAIL") {
        const body = await responseContents(res, ctype(preq))
        const result = parseForm(body)
        const mt = result?.BTI_ERROR_MSG.BTIEM_MSGTYP
        if (result?.TRKORR && mt !== "E" && mt !== "W") return result.TRKORR
      }
    }
  }
}

export const getServer = () => {
  if (server) return server

  const { url, port, systemId } = config()

  const proxy = Server.createProxyServer({ target: url, changeOrigin: true })
  if (systemId) {
    proxy.on("start", async preq => {
      if (systemId && isFormCreate(preq))
        requestBodies.set(preq, streamContents(preq, ctype(preq)))
    })
  }
  proxy.on("proxyRes", async (preq, req, res) => {
    const trnumber = await formWasCreated(preq, req, res, !!systemId)
    try {
      if (trnumber) formCreated.fire(trnumber)
    } catch (error) {
      // TODO: improve error handling
    }
  })
  server = proxy.listen(port)
  return server
}

export const onFormCreated = formCreated.event
export const close = () => new Promise((r: any) => server && server.close(r))
