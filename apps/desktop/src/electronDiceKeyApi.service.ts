import { shell, ipcMain } from "electron";
export interface DiceKeysApiService {
  getMasterPasswordDerivedFromDiceKey: () => Promise<string>;
}

const clientAppsProtocol = "bitwarden:";
const defaultRecipe = `{"allow":[{"host":"*.bitwarden.com"}]}`;
const defaultPathName = `/--derived-secret-api--/`;
interface RequestParameters {
  requestId: string;
  command?: "getPassword";
  recipe?: string;
  respondTo?: string;
}
const encodeRequestParameters = (
  {
    requestId,
    command = "getPassword",
    recipe = defaultRecipe,
    respondTo = `${clientAppsProtocol}${defaultPathName}`,
  }: RequestParameters
) =>   // URL encoded the four parameters and combine them using the URL `&` notation
  Object.entries({ command, recipe, requestId, respondTo })
    .reduce((result, [fieldName, fieldValue]) => {
      result.push(`${fieldName}=${encodeURIComponent(fieldValue)}`);
      return result;
    }, [] as string[])
    .join("&");

class DiceKeysApiServiceImplementation implements DiceKeysApiService {
  private requestIdToPromiseCallbacks = new Map<string, { resolve: (password: string) => void; reject: (error: any) => void; }>();

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
      return false;
    }
    const parsedPasswordJson = JSON.parse(passwordJson) as {password: string};
    // console.log(`passwordJson`, parsedPasswordJson);
    if (parsedPasswordJson == null || typeof parsedPasswordJson !== "object" || typeof (parsedPasswordJson.password) !== "string") {
      promiseCallbacks.reject(new Error("response json did not contain a string field named 'password'"));
      return false;
    }
    const {password} = parsedPasswordJson;
    // console.log(`password`, password);
    promiseCallbacks.resolve(password);
    return true;
  }

  getMasterPasswordDerivedFromDiceKey = (): Promise<string> => new Promise<string>((resolve, reject) => {
    // Generate 16-character hex random request id.
    const requestId = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    try {
      // const webRequestUrl = `https://dicekeys.app?${encodeRequestParameters({requestId})}`;
      const webRequestUrl = `http://localhost:3000?${encodeRequestParameters({requestId})}`;
      const customSchemeRequestUrl = `dicekeys://?${encodeRequestParameters({requestId})}`;
      this.requestIdToPromiseCallbacks.set(requestId, { resolve, reject });
      // console.log(`requestUrl=${requestUrl}`);
      
      shell.openExternal(customSchemeRequestUrl).catch( () => {
        // If couldn't open the built-in app, open via the web
        shell.openExternal(webRequestUrl);
      })
    } catch (e) {
      this.requestIdToPromiseCallbacks.delete(requestId);
      reject(e);
    }
  });

  constructor() {
    ipcMain.handle("getMasterPasswordDerivedFromDiceKey", async (event, responseChannel: string, ...args: Parameters<typeof DiceKeyApiService.getMasterPasswordDerivedFromDiceKey> ) => {
      try {
        return await this.getMasterPasswordDerivedFromDiceKey(...args);
      } catch (e) {
        return e;
      }
    });
  }

}
export const DiceKeyApiService = new DiceKeysApiServiceImplementation();