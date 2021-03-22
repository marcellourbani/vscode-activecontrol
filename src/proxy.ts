import * as Server from "http-proxy"
import { Uri, EventEmitter } from "vscode"
import { ServerResponse } from "http"
import { config } from "./config"
import { parseForm } from "./transportForm"
import { unzipSync, inflateSync, brotliDecompressSync } from "zlib"
import { Readable } from "stream"
const formCreated = new EventEmitter<string>()

const urlAction = (url: string) => {
  const hit = Uri.parse(url)
    .query.split("&")
    .map(c => c.split("="))
    .find(c => c[0].toUpperCase() === "ACTION")
  return hit && hit[1]
}

const responseContents = (res: ServerResponse, ce: string) =>
  new Promise<string>(resolve => {
    const chunks: any[] = []
    const resolver = (rs: Readable) =>
      rs
        .on("data", chunk => chunks.push(chunk))
        .on("close", () => {
          const raw = Buffer.concat(chunks)
          switch (ce) {
            case "gzip":
              resolve(unzipSync(raw).toString())
              break;
            case "br":
              resolve(brotliDecompressSync(raw).toString())
              break;
            case "deflate":
              resolve(inflateSync(raw).toString())
              break;
            default:
              resolve(raw.toString())
          }
        })
    res.on("pipe", resolver)
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
        const body = await responseContents(res, preq.headers["content-encoding"] || "")
        const result = parseForm(body)
        const mt = result?.BTI_ERROR_MSG.BTIEM_MSGTYP
        if (result?.TRKORR && mt !== "E" && mt !== "W")
          formCreated.fire(result.TRKORR)
      }
    }
  })
  server = proxy.listen(port)
  return server
}

export const onFormCreated = formCreated.event
export const close = () => new Promise((r: any) => server && server.close(r))
