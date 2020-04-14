import { Disposable } from "vscode";
export declare type TransportValidator = (transport: string, type: string, name: string, devClass: string) => Promise<boolean>;
export interface AbapFsApi {
    registerTransportValidator: (v: TransportValidator) => Disposable;
}
export declare const api: AbapFsApi;
