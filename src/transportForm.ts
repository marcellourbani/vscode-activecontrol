import { getServer, onFormCreated } from "./proxy"
import { window, ProgressLocation, CancellationToken } from "vscode"
import { none, some, isNone } from "fp-ts/lib/Option"
import * as opn from "open"
import got from "got"
import { config } from "./config"
import { PasswordVault } from "./externalmodules"
import { XMLParser, X2jOptionsOptional, strnumOptions } from "fast-xml-parser"

const parse = (xml: string, options: X2jOptionsOptional = {}) =>
  new XMLParser(options).parse(xml)

async function createTF(transport: string, extToken?: CancellationToken) {
  const server = getServer()
  if (!server) return true
  const { port, systemId } = config()

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: `Creating transport form for ${transport}`
    },
    (progress, intToken) =>
      new Promise<boolean>(async resolve => {
        if (extToken?.isCancellationRequested) resolve(false)
        else {
          const sub = onFormCreated(form => {
            if (form === transport) resolve(true)
            else resolve(false)
            sub.dispose()
          })
          const onCancel = () => {
            resolve(false)
            sub.dispose()
          }
          if (extToken) extToken.onCancellationRequested(onCancel)
          if (intToken) intToken.onCancellationRequested(onCancel)
          if (systemId) opn(`http://localhost:${port}/dashboard/#/${systemId}/transportform/?hash=/type/EXISTING_REQUEST/request/${transport}`)
          else opn(`http://localhost:${port}/sap/bc/bsp/bti/te_bsp_new/main.html#transportform/create/trkorr=${transport}`)
        }
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
    const vault = PasswordVault.get()
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
  const vault = PasswordVault.get()
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

function transportNeedsForm(transport: string, filters: RegExp[]) {
  return (
    filters.length === 0 ||
    !!filters.find(f => transport.toUpperCase().match(f))
  )
}

export async function createFormIfMissing(
  transport: string,
  _: string,
  __: string,
  ___: string,
  token?: CancellationToken
) {
  const { user, filters } = config()
  if (!transportNeedsForm(transport, filters)) return true
  const pasopt = user && (await getPassword(user))
  if (!pasopt || isNone(pasopt)) return true
  const { password, isNew } = pasopt.value
  const hasTf = await checkTransportForm(transport, user, password)
  await storepass(user, password, isNew)
  if (hasTf) return true
  return createTF(transport, token)
}

export const parseForm = (xml: string) => {
  const raw = parse(xml)
  const root = raw?.TRANSPORT || raw?.["asx:abap"]?.["asx:values"]?.TRANSPORT
  const { TRKORR, BTI_ERROR_MSG, HASFORM } = root
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
