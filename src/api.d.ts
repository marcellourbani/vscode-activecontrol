import { Disposable, CancellationToken } from "vscode";
export declare type TransportValidator = (transport: string, type: string, name: string, devClass: string, token?: CancellationToken) => Promise<boolean>;
export interface AbapFsApi {
    registerTransportValidator: (v: TransportValidator) => Disposable;
}
export declare const api: AbapFsApi;
