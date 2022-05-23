import { Component, NgZone, OnDestroy, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { ipcRenderer } from "electron"

import { RegisterComponent as BaseRegisterComponent } from "jslib-angular/components/register.component";
import { ApiService } from "jslib-common/abstractions/api.service";
import { AuthService } from "jslib-common/abstractions/auth.service";
import { BroadcasterService } from "jslib-common/abstractions/broadcaster.service";
import { CryptoService } from "jslib-common/abstractions/crypto.service";
import { EnvironmentService } from "jslib-common/abstractions/environment.service";
import { I18nService } from "jslib-common/abstractions/i18n.service";
import { LogService } from "jslib-common/abstractions/log.service";
import { PasswordGenerationService } from "jslib-common/abstractions/passwordGeneration.service";
import { PlatformUtilsService } from "jslib-common/abstractions/platformUtils.service";
import { StateService } from "jslib-common/abstractions/state.service";
import type { GetMasterPasswordDerivedFromDiceKeyResponse } from "src/electronDiceKeyApi.service";

const BroadcasterSubscriptionId = "RegisterComponent";

@Component({
  selector: "app-register",
  templateUrl: "register.component.html",
})
export class RegisterComponent extends BaseRegisterComponent implements OnInit, OnDestroy {
  constructor(
    authService: AuthService,
    router: Router,
    i18nService: I18nService,
    cryptoService: CryptoService,
    apiService: ApiService,
    stateService: StateService,
    platformUtilsService: PlatformUtilsService,
    passwordGenerationService: PasswordGenerationService,
    environmentService: EnvironmentService,
    private broadcasterService: BroadcasterService,
    private ngZone: NgZone,
    logService: LogService
  ) {
    super(
      authService,
      router,
      i18nService,
      cryptoService,
      apiService,
      stateService,
      platformUtilsService,
      passwordGenerationService,
      environmentService,
      logService
    );
  }

  async requestDiceKeyDerivedMasterPassword(): Promise<void> {
    const masterPasswordOrException = await ipcRenderer.invoke("getMasterPasswordDerivedFromDiceKey") as GetMasterPasswordDerivedFromDiceKeyResponse;
    console.log(`Recieved master password`, masterPasswordOrException);
    if (typeof masterPasswordOrException.password === "string") {
      // Set the master password
      const {password, centerLetterAndDigit} = masterPasswordOrException;
      console.log(`requestDiceKeyDerivedMasterPassword with centerLetterAndDigit="${centerLetterAndDigit}"`)
      this.masterPassword = this.confirmMasterPassword = password;
      if (centerLetterAndDigit != null) {
        const hint = `Use the DiceKey with ${centerLetterAndDigit} at center`
        console.log(`requestDiceKeyDerivedMasterPassword with hint="${hint}"`)
        this.hint = hint;
      }
    } else {
      // Error notification here if appropraite
      // throw masterPasswordOrException;
    }
  }

  async ngOnInit() {
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      this.ngZone.run(() => {
        switch (message.command) {
          case "windowHidden":
            this.onWindowHidden();
            break;
          default:
        }
      });
    });

    super.ngOnInit();
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  onWindowHidden() {
    this.showPassword = false;
  }
}
