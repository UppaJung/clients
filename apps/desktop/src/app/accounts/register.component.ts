import { Component, NgZone, OnDestroy, OnInit } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { Router } from "@angular/router";

import { RegisterComponent as BaseRegisterComponent } from "@bitwarden/angular/components/register.component";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/abstractions/auth.service";
import { BroadcasterService } from "@bitwarden/common/abstractions/broadcaster.service";
import { CryptoService } from "@bitwarden/common/abstractions/crypto.service";
import { EnvironmentService } from "@bitwarden/common/abstractions/environment.service";
import { FormValidationErrorsService } from "@bitwarden/common/abstractions/formValidationErrors.service";
import { I18nService } from "@bitwarden/common/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/abstractions/log.service";
import { PasswordGenerationService } from "@bitwarden/common/abstractions/passwordGeneration.service";
import { PlatformUtilsService } from "@bitwarden/common/abstractions/platformUtils.service";
import { StateService } from "@bitwarden/common/abstractions/state.service";

import { DiceKeysApiServiceClient } from "./login.component";

const BroadcasterSubscriptionId = "RegisterComponent";

@Component({
  selector: "app-register",
  templateUrl: "register.component.html",
})
export class RegisterComponent extends BaseRegisterComponent implements OnInit, OnDestroy {
  constructor(
    formValidationErrorService: FormValidationErrorsService,
    formBuilder: FormBuilder,
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
      formValidationErrorService,
      formBuilder,
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

  async fetchDiceKeyDerivedMasterPasswordAndUpdate(): Promise<void> {
    try {
      const { password, centerLetterAndDigit, sequenceNumber } =
        await DiceKeysApiServiceClient.getMasterPasswordDerivedFromDiceKey();
      const hintStrings: string[] = [
        ...(centerLetterAndDigit == null
          ? []
          : [`the DiceKey with ${centerLetterAndDigit} in center`]),
        ...(sequenceNumber == null ? [] : [`sequence # ${sequenceNumber}`]),
      ];
      const hint: { hint: string } | Record<string, never> =
        hintStrings.length === 0 ? {} : { hint: `Use ${hintStrings.join(" and ")}.` };
      const formValuesToUpdate = {
        masterPassword: password,
        confirmMasterPassword: password,
        ...hint,
      };
      this.formGroup.patchValue(formValuesToUpdate);
    } catch {
      // Error notification here if appropriate
    }
  }

  diceKeysAppInstalled = false;
  checkIfDiceKeysAppInstalled = async () => {
    this.diceKeysAppInstalled = await DiceKeysApiServiceClient.checkIfDiceKeysAppInstalled();
  };

  async ngOnInit() {
    this.checkIfDiceKeysAppInstalled();
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      this.ngZone.run(() => {
        switch (message.command) {
          case "windowHidden":
            this.onWindowHidden();
            break;
          case "windowIsFocused":
            this.checkIfDiceKeysAppInstalled();
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
