import { Component, NgZone, OnDestroy, ViewChild, ViewContainerRef } from "@angular/core";
import { Router } from "@angular/router";
import { ipcRenderer } from "electron";

import { LoginComponent as BaseLoginComponent } from "@bitwarden/angular/components/login.component";
import { ModalService } from "@bitwarden/angular/services/modal.service";
import { AuthService } from "@bitwarden/common/abstractions/auth.service";
import { BroadcasterService } from "@bitwarden/common/abstractions/broadcaster.service";
import { CryptoFunctionService } from "@bitwarden/common/abstractions/cryptoFunction.service";
import { EnvironmentService } from "@bitwarden/common/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/abstractions/messaging.service";
import { PasswordGenerationService } from "@bitwarden/common/abstractions/passwordGeneration.service";
import { PlatformUtilsService } from "@bitwarden/common/abstractions/platformUtils.service";
import { StateService } from "@bitwarden/common/abstractions/state.service";
import { SyncService } from "@bitwarden/common/abstractions/sync.service";

import type { DiceKeysApiServiceInterface } from "../../electronDiceKeyApi.service";

import { EnvironmentComponent } from "./environment.component";

const BroadcasterSubscriptionId = "LoginComponent";

// Awaited is built into TS >=4.5, but Bitwarden isn't using that yet.
export type Awaited<T> = T extends Promise<infer U> ? U : T;
export const DiceKeysApiServiceClient = new (class DiceKeysApiServiceClientImplementation {
  private static implement =
    <FN_NAME extends keyof DiceKeysApiServiceInterface>(fnName: FN_NAME) =>
    async (
      ...args: Parameters<DiceKeysApiServiceInterface[FN_NAME]>
    ): Promise<Awaited<ReturnType<DiceKeysApiServiceInterface[FN_NAME]>>> => {
      return (await ipcRenderer.invoke(fnName)) as Awaited<
        ReturnType<DiceKeysApiServiceInterface[FN_NAME]>
      >;
    };
  getMasterPasswordDerivedFromDiceKey = DiceKeysApiServiceClientImplementation.implement(
    "getMasterPasswordDerivedFromDiceKey"
  );
  checkIfDiceKeysAppInstalled = DiceKeysApiServiceClientImplementation.implement(
    "checkIfDiceKeysAppInstalled"
  );
})();

@Component({
  selector: "app-login",
  templateUrl: "login.component.html",
})
export class LoginComponent extends BaseLoginComponent implements OnDestroy {
  @ViewChild("environment", { read: ViewContainerRef, static: true })
  environmentModal: ViewContainerRef;

  showingModal = false;

  protected alwaysRememberEmail = true;

  private deferFocus: boolean = null;

  constructor(
    authService: AuthService,
    router: Router,
    i18nService: I18nService,
    syncService: SyncService,
    private modalService: ModalService,
    platformUtilsService: PlatformUtilsService,
    stateService: StateService,
    environmentService: EnvironmentService,
    passwordGenerationService: PasswordGenerationService,
    cryptoFunctionService: CryptoFunctionService,
    private broadcasterService: BroadcasterService,
    ngZone: NgZone,
    private messagingService: MessagingService,
    logService: LogService
  ) {
    super(
      authService,
      router,
      platformUtilsService,
      i18nService,
      stateService,
      environmentService,
      passwordGenerationService,
      cryptoFunctionService,
      logService,
      ngZone
    );
    super.onSuccessfulLogin = () => {
      return syncService.fullSync(true);
    };
  }

  diceKeysAppInstalled = false;
  checkIfDiceKeysAppInstalled = async () => {
    this.diceKeysAppInstalled = await DiceKeysApiServiceClient.checkIfDiceKeysAppInstalled();
  };

  async ngOnInit() {
    await super.ngOnInit();
    this.checkIfDiceKeysAppInstalled();
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      this.ngZone.run(() => {
        switch (message.command) {
          case "windowHidden":
            this.onWindowHidden();
            break;
          case "windowIsFocused":
            this.checkIfDiceKeysAppInstalled();
            if (this.deferFocus === null) {
              this.deferFocus = !message.windowIsFocused;
              if (!this.deferFocus) {
                this.focusInput();
              }
            } else if (this.deferFocus && message.windowIsFocused) {
              this.focusInput();
              this.deferFocus = false;
            }
            break;
          default:
        }
      });
    });
    this.messagingService.send("getWindowIsFocused");
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  async settings() {
    const [modal] = await this.modalService.openViewRef(
      EnvironmentComponent,
      this.environmentModal
    );

    modal.onShown.subscribe(() => {
      this.showingModal = true;
    });
    modal.onClosed.subscribe(() => {
      this.showingModal = false;
    });
  }

  async requestDiceKeyDerivedMasterPassword(): Promise<void> {
    try {
      const { password } = await DiceKeysApiServiceClient.getMasterPasswordDerivedFromDiceKey();
      // Set the master password
      this.masterPassword = password;
    } catch {
      /**/
    }
  }

  onWindowHidden() {
    this.showPassword = false;
  }

  async submit() {
    await super.submit();
    if (this.captchaSiteKey) {
      const content = document.getElementById("content") as HTMLDivElement;
      content.setAttribute("style", "width:335px");
    }
  }
}
