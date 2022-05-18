import { shell, ipcMain } from "electron";

export interface DiceKeysApiService {
  getMasterPasswordDerivedFromDiceKey: () => Promise<string>;
}

class DiceKeysApiServiceImplementation implements DiceKeysApiService {
  private requestIdToPromiseCallbacks = new Map<string, { resolve: (password: string) => void; reject: (error: any) => void; }>();

  /**
   * Create a URL for requesting a password derived from a DiceKey from the
   * DiceKeys web app or thick client.
   */
  private createRequestUrl = ({
    requestId, command = "getPassword", scheme = "https", host = "dicekeys.app", recipe = `{"allow":[{"host":"*.bitwarden.com"}]}`, respondTo = `bitwarden:/--derived-secret-api--/`,
  }: {
    requestId: string;
    command?: "getPassword";
    scheme?: "http" | "https";
    host?: string;
    recipe?: string;
    allow?: string;
    respondTo?: string;
  }): string =>
    // e.g. https://
    `${scheme}://${host}/?${
    // URL encoded the four parameters and combine them using the URL `&` notation
    Object.entries({ command, recipe, requestId, respondTo })
      .reduce((result, [fieldName, fieldValue]) => {
        result.push(`${fieldName}=${encodeURIComponent(fieldValue)}`);
        return result;
      }, [] as string[])
      .join("&")}`;

  public handlePotenentialApiReponseUrl = (url: URL): boolean => {
    console.log(`handleUrlResponse received URL with path`, url.pathname);
    if (url.pathname != `/--derived-secret-api--/`) {
      return false;
    }
    const requestId = url.searchParams.get("requestId");
    console.log(`requestId`, requestId);
    if (requestId == null) {
      return false;
    }
    const promiseCallbacks = this.requestIdToPromiseCallbacks.get(requestId);
    // console.log(`requestId`, requestId, promiseCallbacks);
    if (promiseCallbacks == null) {
      return false;
    }
    this.requestIdToPromiseCallbacks.delete(requestId);
    const passwordJson = url.searchParams.get("passwordJson");
    // console.log(`passwordJson`, passwordJson);
    if (typeof passwordJson !== "string") {
      promiseCallbacks.reject(new Error("response did not contain passwordJson"));
    }
    const parsedPasswordJson = JSON.parse(passwordJson) as {password: string};
    // console.log(`passwordJson`, parsedPasswordJson);
    if (typeof parsedPasswordJson !== "object" || parsedPasswordJson == null || typeof (parsedPasswordJson.password) !== "string") {
      promiseCallbacks.reject(new Error("response json did not contain a string field named 'password'"));
    }
    const {password} = parsedPasswordJson;
    // console.log(`password`, password);
    promiseCallbacks.resolve(password);
    return true;
  }

  getMasterPasswordDerivedFromDiceKey = (): Promise<string> => new Promise<string>(async (resolve, reject) => {
    // Generate 16-character hex random request id.
    const requestId = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    try {
      const devParameters = { scheme: "http", host: "localhost:3000" } as const;
      const requestUrl = this.createRequestUrl({ ...devParameters, requestId });
      this.requestIdToPromiseCallbacks.set(requestId, { resolve, reject });
      // console.log(`requestUrl=${requestUrl}`);
      await shell.openExternal(requestUrl);
    } catch (e) {
      this.requestIdToPromiseCallbacks.delete(requestId);
      reject(e);
    }
  });

  constructor() {
    ipcMain.handle("getMasterPasswordDerivedFromDiceKey", async (event, responseChannel: string, ...args: Parameters<typeof DiceKeyApiService.getMasterPasswordDerivedFromDiceKey> ) => {
      return await(this.getMasterPasswordDerivedFromDiceKey(...args));
    });
  }

}
export const DiceKeyApiService = new DiceKeysApiServiceImplementation();