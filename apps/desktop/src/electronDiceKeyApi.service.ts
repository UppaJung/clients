import { spawn } from "child_process";

import { shell, ipcMain } from "electron";

/**
 * Fields returned when `getMasterPasswordDerivedFromDiceKey`
 * is called.
 */
export interface GetMasterPasswordDerivedFromDiceKeyResponse {
  password: string;
  centerLetterAndDigit?: string;
  sequenceNumber?: string;
}

export interface DiceKeysApiServiceInterface {
  getMasterPasswordDerivedFromDiceKey: () => Promise<{
    /** The password generated from a DiceKey */
    password: string;
    /** The center letter and digit of the DiceKey used to generate a password.
     * This may be stored and kept as a hint so that the user knows which DiceKey
     * to use to re-generate the password in the future.
     */
    centerLetterAndDigit?: string;
    /** The sequence number added to the recipe to change the password. For example,
     * a user might use different sequence numbers to generate master passwords for two
     * different users in the same family, or increment a sequence number if they think
     * their old master password might have been compromised.
     */
    sequenceNumber?: string;
  }>;
  checkIfDiceKeysAppInstalled: () => Promise<boolean>;
}

/**
 * Execute a shell command and test to see whether the response to
 * standard out matches a potential outcome
 * @param testOutputCallback a function that takes strings sent to standard out
 * and returns true if the shell test should return true.
 * @param spawnArgs args passed on to the electron's spawn command
 * @returns true IFF any call to testOutputCallback with data the shell command
 * sent to stdout returns true.  False otherwise.
 */
const shellTest = (
  testOutputCallback: (stdOutString: string) => boolean,
  ...spawnArgs: Parameters<typeof spawn>
): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    // ensure the promise is resolved only once
    let resolved = false;
    const resolveOnce = (result: boolean, debugStr?: string) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    // spawn the child with the requested arguments
    const child = spawn(...spawnArgs);
    // when data is received on stdout, call the testOutputCallback and resolve to true
    // IFF the callback returns true.
    child.stdout.on("data", (data) => {
      const dataAsStr: string | undefined =
        typeof data === "string" ? data : data instanceof Buffer ? data.toString() : undefined;
      if (dataAsStr != null && testOutputCallback(dataAsStr)) {
        resolveOnce(true, dataAsStr);
      }
    });
    // return false if not true within 10ms of exit
    child.on("exit", () => setTimeout(() => resolveOnce(false), 10));
  });

/**
 * On MacOS, we can test if the DiceKeys app is installed by using spotlight (mdfind)
 * to search for an app with bundle identifier of com.dicekeys.app.
 * @returns true iff the DiceKeys app is installed
 */
const isDiceKeysAppInstalledMac = () =>
  shellTest(
    (result) => result.indexOf("DiceKeys.app") != -1,
    "mdfind",
    [`kMDItemCFBundleIdentifier == com.dicekeys.app`],
    {}
  );

/**
 * On MacOS, we can test if the DiceKeys app is installed by using spotlight (mdfind)
 * to search for an app with bundle identifier of com.dicekeys.app.
 * @returns true iff the DiceKeys app is installed
 */
const isDiceKeysAppInstalledWindows = () =>
  shellTest(
    (result) => result.indexOf("REG_SZ") != -1,
    "reg",
    ["query", "HKEY_CLASSES_ROOT\\dicekeys\\shell\\open\\command"],
    {}
  );

/** The custom protocol used for inter-application communication */
const clientAppsProtocol = "bitwarden:";
/** The recipe to use to generate passwords */
const defaultRecipe = `{"allow":[{"host":"*.bitwarden.com"}]}`;
/** The path used, such that responses come to bitwarden:/--derived-secret-api--/.
 * This path is required so that responses from the DiceKeys API can't be used for XSS
 * attacks.
 */
const defaultPathName = `/--derived-secret-api--/`;
interface RequestParameters {
  requestId: string;
  command?: "getPassword";
  recipe?: string;
  respondTo?: string;
}

/**
 * encodes a DiceKeys API request given a command, recipe, requestId, and respondTo parameter
 * @param param0 an object containing a requestID and optional for
 * the `command` to send (default: `getPassword`), `recipe`, and `respondTo` path.
 * @returns A URL string for issuing an API request to DiceKeys
 */
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

/**
 * This class implements a service in the main Electron process that
 * tests if the DiceKeys app is present and, if so, uses that API
 * to request DiceKey-generated master passwords.
 */
export const DiceKeysApiService = new (class DiceKeysApiServiceImplementation
  implements DiceKeysApiServiceInterface
{
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

  /**
   * Test if the DiceKeys app is installed on this computer
   * @returns true iff the DiceKeys app is installed.
   */
  checkIfDiceKeysAppInstalled = (): Promise<boolean> =>
    process.platform === "darwin"
      ? isDiceKeysAppInstalledMac()
      : process.platform === "win32"
      ? isDiceKeysAppInstalledWindows()
      : // Unknown OS.  Just return false.
        new Promise<boolean>((resolve) => resolve(false));

  /**
   * Sends a request to the DiceKeys app for a DiceKeys-generated master password and
   * awaits the response.
   * @returns A promise to an object with a password string field and two other fields that
   * might help re-generate the password in the future.
   */
  getMasterPasswordDerivedFromDiceKey = (): Promise<GetMasterPasswordDerivedFromDiceKeyResponse> =>
    new Promise<GetMasterPasswordDerivedFromDiceKeyResponse>((resolve, reject) => {
      // Generate 16-character hex random request id.
      const requestId = [...Array(16)]
        .map(() => Math.floor(Math.random() * 16).toString(16))
        .join("");
      try {
        const webRequestUrl = `https://dicekeys.app?${encodeRequestParameters({
          requestId,
        })}`;
        const customSchemeRequestUrl = `dicekeys://?${encodeRequestParameters({ requestId })}`;
        this.requestIdToPromiseCallbacks.set(requestId, { resolve, reject });

        shell.openExternal(customSchemeRequestUrl).catch(() => {
          // If couldn't open the built-in app, open via the web
          shell.openExternal(webRequestUrl);
        });
      } catch (e) {
        this.requestIdToPromiseCallbacks.delete(requestId);
        reject(e);
      }
    });

  /**
   * This helper function ensures the implementation of the API matches that in the interface.
   * @param fnName The name of the function to implement from the `DiceKeysApiServiceInterface`
   * @param fnImplementation The implementation fo the function from the `DiceKeysApiServiceInterface`
   * @returns void
   */
  private static addIpcMainHandler = <FN_NAME extends keyof DiceKeysApiServiceInterface>(
    fnName: FN_NAME,
    fnImplementation: DiceKeysApiServiceInterface[FN_NAME]
  ) =>
    ipcMain.handle(fnName, (_event, ...args) =>
      fnImplementation(
        ...(args as Parameters<DiceKeysApiServiceInterface[keyof DiceKeysApiServiceInterface]>)
      )
    );

  constructor() {
    // Add handlers for the functions the main process provides to the
    // processes running in windows.
    DiceKeysApiServiceImplementation.addIpcMainHandler(
      "checkIfDiceKeysAppInstalled",
      this.checkIfDiceKeysAppInstalled
    );
    DiceKeysApiServiceImplementation.addIpcMainHandler(
      "getMasterPasswordDerivedFromDiceKey",
      this.getMasterPasswordDerivedFromDiceKey
    );
  }
})();
