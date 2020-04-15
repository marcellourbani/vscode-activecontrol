import { getServer, onFormCreated } from "./proxy"
import { window, ProgressLocation } from "vscode"
import { none, some, isNone } from "fp-ts/lib/Option"
import * as opn from "open"
import got from "got"
import { config } from "./config"
import { PasswordVault } from "./externalmodules"
import { parse } from "fast-xml-parser"

async function createTF(transport: string) {
  const server = getServer()
  if (!server) return true
  const { port } = config()

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: `Creating transport form for ${transport}`
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

const passwords = new Map<string, string>()
const askPass = (user: string) =>
  window.showInputBox({
    prompt: `Enter ActiveControl password for ${user}`,
    ignoreFocusOut: true,
    password: true
  })

const service = "vscode_activecontrol"
async function getPassword(user: string) {
  let password = passwords.get(user)
  let isNew = false
  if (!password) {
    const vault = new PasswordVault()
    password = (await vault.getPassword(service, user)) || ""
    if (!password) {
      password = await askPass(user)
      if (!password) return none
      isNew = true
    }
  }
  return some({ password, isNew })
}

const storepass = async (user: string, password: string, isNew: boolean) => {
  passwords.set(user, password)
  const vault = new PasswordVault()
  await vault.setPassword(service, user, password)
}

const checkTransportForm = async (
  transport: string,
  username: string,
  password: string
) => {
  const { url } = config()
  const response = await got(
    `${url}/bti/te_web_services?action=GETREQUESTDETAIL&TRKORR=${transport}`,
    { username, password }
  )
  const form = parseForm(response.body)

  return form?.TRKORR === transport && form.HASFORM
}

export async function createFormCmd() {
  const transport = await window.showInputBox({
    prompt: "Enter transport number",
    ignoreFocusOut: true,
    validateInput: v => {
      if (!v.match(/^[a-z]\w\wK\w\w\w\w\w\w$/i))
        return "Invalid transport number"
    }
  })
  if (transport) return createTF(transport.toUpperCase())
}

export async function createFormIfMissing(transport: string) {
  const { user } = config()
  const pasopt = user && (await getPassword(user))
  if (!pasopt || isNone(pasopt)) return true // TODO: ask user
  const { password, isNew } = pasopt.value
  const hasTf = await checkTransportForm(transport, user, password)
  await storepass(user, password, isNew)
  if (hasTf) return true
  return createTF(transport)
}

export const parseForm = (xml: string) => {
  const raw = parse(xml)?.["asx:abap"]?.["asx:values"]?.TRANSPORT
  const { TRKORR, BTI_ERROR_MSG, HASFORM } = raw
  const {
    BTIEM_MSGTYP,
    BTIEM_TITLE,
    BTIEM_MESSAGE,
    BTIEM_OVERRIDES,
    BTIEM_EXCEPTION,
    BTIEM_GUID,
    BTIEM_IN_PROGRESS
  } = BTI_ERROR_MSG

  if (TRKORR || BTIEM_MSGTYP)
    return {
      TRKORR,
      HASFORM,
      BTI_ERROR_MSG: {
        BTIEM_MSGTYP,
        BTIEM_TITLE,
        BTIEM_MESSAGE,
        BTIEM_OVERRIDES,
        BTIEM_EXCEPTION,
        BTIEM_GUID,
        BTIEM_IN_PROGRESS
      }
    }
}
