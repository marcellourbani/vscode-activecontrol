import { getServer, onFormCreated } from "./proxy"
import { window, ProgressLocation, CancellationToken } from "vscode"
import { none, some, isNone } from "fp-ts/lib/Option"
import * as opn from "open"
import got, { HTTPError } from "got"
import { config } from "./config"
import { PasswordVault } from "./externalmodules"
import { XMLParser, X2jOptionsOptional } from "fast-xml-parser"
import { isString } from "fp-ts/lib/string"

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
          const path = systemId
            ? `/dashboard/#/${systemId}/transportform/?hash=/type/EXISTING_REQUEST/request/${transport}`
            : `/sap/bc/bsp/bti/te_bsp_new/main.html#transportform/create/trkorr=${transport}`
          opn(`http://localhost:${port}${path}`)
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

let lastToken: string | undefined

async function loginIfNeeded(
  url: string,
  username: string,
  password: string,
  system: string
) {
  if (lastToken) return lastToken
  const json = { system, username, password, pwIsNotEncoded: true }
  const response = await got.post(`${url}/api/login`, { json }).json()
  const token = (response as any).access_token
  if (isString(token)) {
    lastToken = token
    setTimeout(() => (lastToken = ""), 3600000) // TODO properly expire token
    return token
  }
  throw new Error("Login failed")
}

const checkTFExist = async (url: string, transport: string, token: string) => {
  try {
    const opts = { headers: { Authorization: `Bearer ${token}` } }
    const formd = await got(
      `${url}/api/newFormDefaults/${transport}`,
      opts
    ).json()
    // TODO type check ?
    return false
  } catch (error) {
    if (
      error instanceof HTTPError &&
      error.response.statusCode === 422 &&
      isString(error.response.body)
    ) {
      const body = JSON.parse(error.response.body)
      if (body?.exceptionId === "TransportFormExists") return true
    }
    throw error
  }
}

const checkTransportForm = async (
  transport: string,
  username: string,
  password: string
) => {
  const { url, systemId } = config()
  if (systemId) {
    const token = await loginIfNeeded(url, username, password, systemId)
    return checkTFExist(url, transport, token)
  } else {
    const response = await got(
      `${url}/bti/te_web_services?action=GETREQUESTDETAIL&TRKORR=${transport}`,
      { username, password }
    )
    const form = parseForm(response.body)

    return form?.TRKORR === transport && form.HASFORM
  }
}

const trinput = () =>
  window.showInputBox({
    prompt: "Enter transport number",
    ignoreFocusOut: true,
    validateInput: v => {
      if (!v.match(/^[a-z]\w\wK\w\w\w\w\w\w$/i))
        return "Invalid transport number"
    }
  })

export async function createFormCmd() {
  const transport = await trinput()
  if (transport) return createTF(transport.toUpperCase())
}

function transportNeedsForm(transport: string, filters: RegExp[]) {
  return (
    filters.length === 0 ||
    !!filters.find(f => transport.toUpperCase().match(f))
  )
}

const checkFormWithPw = async (user: string, transport: string) => {
  const pasopt = user && (await getPassword(user))
  if (!pasopt || isNone(pasopt)) return true
  const { password, isNew } = pasopt.value
  const hasTf = await checkTransportForm(transport, user, password)
  await storepass(user, password, isNew)
  if (hasTf) return true
}

export const formExists = async () => {
  const transport = await trinput()
  if (!transport) return
  const { user, filters } = config()
  if (!transportNeedsForm(transport, filters)) {
    window.showInformationMessage(`Transport ${transport} doesn't need a form`)
    return
  }
  const hasTf = await checkFormWithPw(user, transport)
  window.showInformationMessage(
    `Transport ${transport} ${hasTf ? "has" : "doesn't have"} a form`
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
  const hasTf = await checkFormWithPw(user, transport)
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
