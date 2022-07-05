import { Component, NgZone, OnDestroy, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { ipcRenderer } from "electron"

import type { GetMasterPasswordDerivedFromDiceKeyResponse } from "src/electronDiceKeyApi.service";
import { RegisterComponent as BaseRegisterComponent } from "@bitwarden/angular/components/register.component";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/abstractions/auth.service";
import { BroadcasterService } from "@bitwarden/common/abstractions/broadcaster.service";
import { CryptoService } from "@bitwarden/common/abstractions/crypto.service";
import { EnvironmentService } from "@bitwarden/common/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/abstractions/log.service";
import { PasswordGenerationService } from "@bitwarden/common/abstractions/passwordGeneration.service";
import { PlatformUtilsService } from "@bitwarden/common/abstractions/platformUtils.service";
import { StateService } from "@bitwarden/common/abstractions/state.service";

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
    console.log(`Received master password`, masterPasswordOrException);
    if (typeof masterPasswordOrException.password === "string") {
      // Set the master password
      const {password, centerLetterAndDigit, sequenceNumber} = masterPasswordOrException;
      console.log(`requestDiceKeyDerivedMasterPassword with centerLetterAndDigit="${centerLetterAndDigit}"`)
      this.masterPassword = this.confirmMasterPassword = password;
      const hints = ((centerLetterAndDigit != null) ? 1 : 0) + ((sequenceNumber != null) ? 1 : 0);
      if (hints > 0) {
        const hint = `Use${
          centerLetterAndDigit == null ? "" : ` the DiceKey with ${centerLetterAndDigit}`
        }${
          hints > 1 ? " and" : ""
        }${
          sequenceNumber == null ? "" : ` sequence number ${sequenceNumber}`
        }`
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
