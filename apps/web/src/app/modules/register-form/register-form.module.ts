import { NgModule } from "@angular/core";

import { SharedModule } from "../shared.module";

import { RegisterFormComponent } from "./register-form.component";

@NgModule({
  imports: [SharedModule],
  declarations: [RegisterFormComponent],
  exports: [RegisterFormComponent],
})
export class RegisterFormModule {}
