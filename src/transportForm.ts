import { getServer, onFormCreated } from "./proxy"
import { window, ProgressLocation, CancellationToken } from "vscode"
import { none, some, isNone, isSome } from "fp-ts/lib/Option"
import * as opn from "open"
import got, { HTTPError } from "got"
import { Configuration, config } from "./config"
import { PasswordVault } from "./externalmodules"
import { XMLParser, X2jOptionsOptional } from "fast-xml-parser"
import { isString } from "fp-ts/lib/string"

const parse = (xml: string, options: X2jOptionsOptional = {}) =>
  new XMLParser(options).parse(xml)

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

const checkTFExistInt = async (
  url: string,
  transport: string,
  token: string
) => {
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

const checkTFExist = async (
  conf: Configuration,
  transport: string,
  username: string,
  password: string
) => {
  const needRetry = !!lastToken
  const token = await loginIfNeeded(conf.url, username, password, conf.systemId)
  try {
    return await checkTFExistInt(conf.url, transport, token)
  } catch (error) {
    if (needRetry && error instanceof HTTPError && error.code === "401") {
      // expired token
      const token2 = await loginIfNeeded(
        conf.url,
        username,
        password,
        conf.systemId
      )
      return checkTFExistInt(conf.url, transport, token2)
    } else throw error
  }
}
const createTfOld = (
  transport: string,
  port: number,
  extToken?: CancellationToken,
  intToken?: CancellationToken
) =>
  new Promise<boolean>(async (resolve) => {
    if (extToken?.isCancellationRequested) resolve(false)
    else {
      const sub = onFormCreated((form) => {
        if (form === transport) resolve(true)
        else resolve(false)
        sub.dispose()
      })
      const onCancel = () => {
        resolve(false)
        sub.dispose()
      }
      extToken?.onCancellationRequested(onCancel)
      intToken?.onCancellationRequested(onCancel)
      const path = `/sap/bc/bsp/bti/te_bsp_new/main.html#transportform/create/trkorr=${transport}`
      opn(`http://localhost:${port}${path}`)
    }
  })

const createTfNew = async (
  transport: string,
  conf: Configuration,
  password: string,
  extToken?: CancellationToken,
  intToken?: CancellationToken
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const complete = (res: boolean) => {
      clearInterval(poller)
      resolve(res)
    }
    const cancel = () => {
      clearInterval(poller)
      resolve(false)
    }
    extToken?.onCancellationRequested(cancel)
    intToken?.onCancellationRequested(cancel)
    const poller = setInterval(async () => {
      try {
        const exists = await checkTFExist(conf, transport, conf.user, password)
        if (exists) complete(true)
      } catch (error) {
        reject(error)
      }
    }, 1000)
    const path = `/dashboard/#/${conf.systemId}/transportform/?hash=/type/EXISTING_REQUEST/request/${transport}`
    opn(`${conf.url}${path}`)
  })

async function createTF(
  transport: string,
  password: string,
  extToken?: CancellationToken
) {
  const conf = config()
  if (!conf.systemId) {
    const server = getServer()
    if (!server) return true
  }

  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      cancellable: true,
      title: `Creating transport form for ${transport}`
    },
    (progress, intToken) =>
      conf.systemId
        ? createTfNew(transport, conf, password, extToken, intToken)
        : createTfOld(transport, conf.port, extToken, intToken)
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

const getAndSavePassword = async <T>(cb: (user: string, pwd: string) => T) => {
  const { user } = config()
  const pasopt = user && (await getPassword(user))
  if (!pasopt || isNone(pasopt)) return
  const { password, isNew } = pasopt.value
  const result = await cb(user, password)
  await storepass(user, password, isNew)
  return result
}

export const getLoginToken = async () => {
  const { url, systemId } = config()
  const token = await getAndSavePassword((user, pass) =>
    loginIfNeeded(url, user, pass, systemId)
  )
  return token
}

const checkTransportForm = async (
  transport: string,
  username: string,
  password: string
) => {
  const conf = config()
  if (conf.systemId) {
    return checkTFExist(conf, transport, username, password)
  } else {
    const response = await got(
      `${conf.url}/bti/te_web_services?action=GETREQUESTDETAIL&TRKORR=${transport}`,
      { username, password }
    )
    const form = parseForm(response.body)

    return form?.TRKORR === transport && form.HASFORM
  }
}

const trinput = () =>
  window
    .showInputBox({
      prompt: "Enter transport number",
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v.match(/^[a-z]\w\wK\w\w\w\w\w\w$/i))
          return "Invalid transport number"
      }
    })
    .then((x) => x?.toUpperCase())

function transportNeedsForm(transport: string, filters: RegExp[]) {
  return (
    filters.length === 0 ||
    !!filters.find((f) => transport.toUpperCase().match(f))
  )
}

const checkFormWithPw = async (transport: string) => {
  const hasTf = await getAndSavePassword((user: string, password: string) =>
    checkTransportForm(transport, user, password)
  )
  if (hasTf) return true
}

const getStoredPassword = (user: string) =>
  getPassword(user).then((pasopt) =>
    isSome(pasopt) ? pasopt.value.password : undefined
  ) //TODO error handling

interface TransportParam {
  task?: { "tm:number": string }
}

export async function createFormCmd(tr?: TransportParam) {
  const transport = tr?.task?.["tm:number"] || (await trinput())
  if (!transport) return
  const { user } = config()

  const hasTf = await checkFormWithPw(transport)
  if (hasTf)
    window.showInformationMessage(`Transport ${transport} already has a form`)
  else {
    const password = await getStoredPassword(user)
    if (!password) return
    return createTF(transport, password)
  }
}

export const formExists = async () => {
  const transport = await trinput()
  if (!transport) return
  const { user, filters } = config()
  if (!transportNeedsForm(transport, filters)) {
    window.showInformationMessage(`Transport ${transport} doesn't need a form`)
    return
  }
  const hasTf = await checkFormWithPw(transport)
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
  const hasTf = await checkFormWithPw(transport)
  if (hasTf) return true
  const password = await getStoredPassword(user)
  if (!password) return false
  return createTF(transport, password, token)
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
