import { ipcMain, shell } from "electron";

type IPC_RENDERER_TO_ELECTRON_getPasswordFromDiceKey = {
    "getPasswordFromDiceKey": () => Promise<string | undefined>;
}
type IPC_RENDERER_TO_ELECTRON = IPC_RENDERER_TO_ELECTRON_getPasswordFromDiceKey;

const ERROR_RESPONSE = "error";
const SUCCESS_RESPONSE = "success";

const implementAsyncRendererToElectronIpcServerFn =
    <T extends {[key: string]: (...args: any[]) => any}>
        (implementations: T) => {
        (Object.keys(implementations) as (keyof T)[]).forEach( <K extends keyof T & string>(fnName: K) => {
            const fn = implementations[fnName] as T[K];
        ipcMain.on(fnName, async (event: Electron.IpcMainEvent, responseChannelName: string, ...args: Parameters<T[K]>) => {
            try {
                const result = await fn(...args);
                event.sender.send(responseChannelName, SUCCESS_RESPONSE, result);
            } catch (exception) {            
                event.sender.send(responseChannelName, ERROR_RESPONSE, exception);
            }
        });
    });
}

const getPasswordFromDiceKey = async () => {
    await shell.openExternal(`https://dicekeys.app/`);
    return "I tried to open the link!";
};

export class TypedRendererToMainAsyncApiListener {
    constructor() {}

    init() {
        implementAsyncRendererToElectronIpcServerFn<IPC_RENDERER_TO_ELECTRON>({
            getPasswordFromDiceKey
        })
    }

  }
  