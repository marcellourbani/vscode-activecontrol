import { WebSocket } from "ws"
import { config } from "./config"
import { getLoginToken } from "./transportForm"
import * as t from "io-ts"
import { isRight } from "fp-ts/lib/Either"
import { commands } from "vscode"
const revision = t.type({
  uri: t.string,
  date: t.string,
  author: t.string,
  version: t.string,
  versionTitle: t.string
})
const conflictDetails = t.type({
  conflicting: t.string,
  objname: t.string,
  object: t.string,
  pgmid: t.string,
  transport: t.string,
  uri: t.string,
  status: t.string,
  incoming: revision,
  conflict: revision
})

type ConflictDetails = t.TypeOf<typeof conflictDetails>

const loginMessage = t.type({
  type: t.literal("authenticated")
})

const diffMessage = t.type({
  type: t.literal("mergeEditor"),
  message: conflictDetails
})

type MergeMessage = t.TypeOf<typeof diffMessage>

const message = t.union([loginMessage, diffMessage])

const launchDiff = async (details: ConflictDetails) => {
  const result = await commands.executeCommand("abapfs.openMergeEditor", {
    uri: details.uri,
    transport: details.transport,
    conflicting: details.conflicting,
    incoming: details.incoming,
    conflict: details.conflict
  })
  return result
}

const registerListenerMsg = (messageId: string) =>
  JSON.stringify({ type: "addListener", message: { messageId } })

class WsHandler {
  private static instance: WsHandler
  private ws: WebSocket | undefined
  private wsPromise: Promise<WebSocket> | undefined
  private connectionInterval: NodeJS.Timer | undefined
  public static get() {
    if (!WsHandler.instance) WsHandler.instance = new WsHandler()
    return WsHandler.instance
  }
  private constructor() {
    this.pollAc()
  }
  private pollAc() {
    this.wsPromise = undefined
    this.ws = undefined
    this.connectionInterval = setInterval(() => this.connect(), 5000)
  }
  async connect(): Promise<void> {
    if (this.ws || this.wsPromise) return
    const conf = config()
    if (!conf.systemId || !conf.listenForCommands) return
    this.wsPromise = new Promise(async (resolve, reject) => {
      const token = encodeURIComponent((await getLoginToken()) || "")
      const cookie = `wp-signed-on=${conf.systemId}; wp-access-token=${token}`
      const opts = { headers: { cookie } }
      const ws = new WebSocket(`${conf.url.replace(/^http/, "ws")}/ws`, opts)
      ws.on("close", () => this.pollAc())
      ws.on("message", (event) => {
        const msg = message.decode(JSON.parse(event.toString()))
        if (isRight(msg)) {
          if (msg.right.type === "authenticated") resolve(ws)
          else this.handleMessage(msg.right)
        }
      })
    })
    this.ws = await this.wsPromise
    clearInterval(this.connectionInterval)
    this.setListeners()
  }
  setListeners() {
    this.ws?.send(registerListenerMsg("mergeEditor"))
  }
  handleMessage(message: MergeMessage) {
    launchDiff(message.message)
  }
}

export const connectWS = () => WsHandler.get()
