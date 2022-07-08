import { spawn } from "child_process";

import { shell, ipcMain } from "electron";

export interface GetMasterPasswordDerivedFromDiceKeyResponse {
  password: string;
  centerLetterAndDigit?: string;

  sequenceNumber?: string;
}
const shellTest = (
  testOutput: (stdOutString: string) => boolean,
  ...spawnArgs: Parameters<typeof spawn>
): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    let resolved = false;
    const resolveOnce = (result: boolean, debugStr?: string) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    const child = spawn(...spawnArgs);
    child.stdout.on("data", (data) => {
      const dataAsStr: string | undefined =
        typeof data === "string" ? data : data instanceof Buffer ? data.toString() : undefined;
      if (dataAsStr != null && testOutput(dataAsStr)) {
        resolveOnce(true, dataAsStr);
      }
    });
    // return false if not true within 10ms of exit
    child.on("exit", () => setTimeout(() => resolveOnce(false), 10));
  });

const isDiceKeysAppInstalledMac = () =>
  shellTest(
    (result) => result.indexOf("DiceKeys.app") != -1,
    "mdfind",
    [`kMDItemCFBundleIdentifier == com.dicekeys.app`],
    {}
  );

const isDiceKeysAppInstalledWindows = () =>
  shellTest((result) => result.indexOf("FIXME") != -1, "reg", ["query", `"fixme"`], {});

export interface DiceKeysApiService {
  getMasterPasswordDerivedFromDiceKey: () => Promise<GetMasterPasswordDerivedFromDiceKeyResponse>;
  isDiceKeysAppInstalled: () => Promise<boolean>;
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
  }: RequestParameters // URL encoded the four parameters and combine them using the URL `&` notation
) =>
  Object.entries({ command, recipe, requestId, respondTo })
    .reduce((result, [fieldName, fieldValue]) => {
      result.push(`${fieldName}=${encodeURIComponent(fieldValue)}`);
      return result;
    }, [] as string[])
    .join("&");

class DiceKeysApiServiceImplementation implements DiceKeysApiService {
  private requestIdToPromiseCallbacks = new Map<
    string,
    {
      resolve: (response: GetMasterPasswordDerivedFromDiceKeyResponse) => void;
      reject: (error: any) => void;
    }
  >();

  handlePotentialApiResponseUrl = (url: URL): boolean => {
    // console.log(`handleUrlResponse received URL with path`, url.pathname);
    if (url.pathname != `/--derived-secret-api--/`) {
      return false;
    }
    const requestId = url.searchParams.get("requestId");
    // console.log(`requestId`, requestId);
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
    const parsedPasswordJson = JSON.parse(passwordJson) as { password: string };
    // console.log(`passwordJson`, parsedPasswordJson);
    if (
      parsedPasswordJson == null ||
      typeof parsedPasswordJson !== "object" ||
      typeof parsedPasswordJson.password !== "string"
    ) {
      promiseCallbacks.reject(
        new Error("response json did not contain a string field named 'password'")
      );
      return false;
    }
    const { password } = parsedPasswordJson;
    const centerLetterAndDigit = url.searchParams.get("centerLetterAndDigit");
    const sequenceNumber = url.searchParams.get("#");
    // console.log(`centerLetterAndDigit="${centerLetterAndDigit}"`);
    // console.log(`sequenceNumber="${sequenceNumber}"`, url.search);
    const result = {
      password,
      ...(centerLetterAndDigit != null && centerLetterAndDigit.length === 2
        ? { centerLetterAndDigit }
        : {}),
      ...(sequenceNumber != null ? { sequenceNumber } : {}),
    };
    // console.log(`password`, password);
    promiseCallbacks.resolve(result);
    return true;
  };

  isDiceKeysAppInstalled = (): Promise<boolean> =>
    process.platform === "darwin"
      ? isDiceKeysAppInstalledMac()
      : process.platform === "win32"
      ? isDiceKeysAppInstalledWindows()
      : // Unknown OS.  Just return false.
        new Promise<boolean>((resolve) => resolve(false));

  getMasterPasswordDerivedFromDiceKey = (): Promise<GetMasterPasswordDerivedFromDiceKeyResponse> =>
    new Promise<GetMasterPasswordDerivedFromDiceKeyResponse>((resolve, reject) => {
      // Generate 16-character hex random request id.
      const requestId = [...Array(16)]
        .map(() => Math.floor(Math.random() * 16).toString(16))
        .join("");
      try {
        // const webRequestUrl = `https://dicekeys.app?${encodeRequestParameters({requestId})}`;
        const webRequestUrl = `https://dicekeys.app?${encodeRequestParameters({
          requestId,
        })}`;
        // const webRequestUrl = `http://localhost:3000?${encodeRequestParameters({requestId})}`;
        const customSchemeRequestUrl = `dicekeys://?${encodeRequestParameters({ requestId })}`;
        this.requestIdToPromiseCallbacks.set(requestId, { resolve, reject });
        // console.log(`requestUrl=${requestUrl}`);

        shell.openExternal(customSchemeRequestUrl).catch(() => {
          // If couldn't open the built-in app, open via the web
          shell.openExternal(webRequestUrl);
        });
      } catch (e) {
        this.requestIdToPromiseCallbacks.delete(requestId);
        reject(e);
      }
    });

  constructor() {
    ipcMain.handle(
      "isDiceKeysAppInstalled",
      async (
        event,
        responseChannel: string,
        ...args: Parameters<typeof DiceKeyApiService.getMasterPasswordDerivedFromDiceKey>
      ) => {
        try {
          return await this.isDiceKeysAppInstalled(...args);
        } catch (e) {
          return e;
        }
      }
    );
    ipcMain.handle(
      "getMasterPasswordDerivedFromDiceKey",
      async (
        event,
        responseChannel: string,
        ...args: Parameters<typeof DiceKeyApiService.getMasterPasswordDerivedFromDiceKey>
      ) => {
        try {
          return await this.getMasterPasswordDerivedFromDiceKey(...args);
        } catch (e) {
          return e;
        }
      }
    );
  }
}
export const DiceKeyApiService = new DiceKeysApiServiceImplementation();
