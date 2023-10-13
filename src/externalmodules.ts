import { ExtensionContext } from "vscode"

const key = (service: string, account: string) => `${service}_${account}`

export class PasswordVault {
  static instance: PasswordVault;
  private constructor(private context: ExtensionContext) {
    PasswordVault.instance = this
  }

  getPassword(service: string, account: string) {
    return this.context.secrets.get(key(service, account))
  }

  setPassword(service: string, account: string, password: string) {
    return this.context.secrets.store(key(service, account), password)
  }

  deletePassword(service: string, account: string) {
    return this.context.secrets.delete(key(service, account))
  }

  static get(context?: ExtensionContext) {
    if (PasswordVault.instance)
      return PasswordVault.instance
    if (context) return new PasswordVault(context)
    throw new Error("Password vault not created yet");

  }
}
