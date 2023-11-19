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

export const connectWS = async () => {
  const conf = config()
  if (!conf.systemId) return // old AC
  const token = await getLoginToken()
  const cookie = `wp-signed-on=${
    conf.systemId
  }; wp-access-token=${encodeURIComponent(token || "")}`
  const ws = new WebSocket(`${conf.url.replace(/^http/, "ws")}/ws`, {
    headers: { cookie }
  })
  ws.on("open", (event: unknown) => {
    console.log(`open: ${event}`)
  })
  ws.on("message", (event) => {
    const msg = message.decode(JSON.parse(event.toString()))
    if (isRight(msg)) {
      if (msg.right.type === "authenticated")
        ws.send(
          JSON.stringify({
            type: "addListener",
            message: { messageId: "mergeEditor" }
          })
        )
      else launchDiff(msg.right.message)
    } else console.log(`${msg.left}`)
  })
}
