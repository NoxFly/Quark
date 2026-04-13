/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { SpinnerComponent } from "@ui/spinner/spinner.component";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";

@Component({
    selector: "ui-loading",
    standalone: true,
    templateUrl: "./loading.component.html",
    styleUrl: "./loading.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [SpinnerComponent],
})
export class LoadingComponent extends UIComponent {
    public readonly message = input<string>();
}
