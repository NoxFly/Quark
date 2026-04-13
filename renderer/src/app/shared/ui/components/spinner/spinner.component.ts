/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, input, ViewEncapsulation } from "@angular/core";
import type { UIColor } from "src/app/shared/ui/ui.types";

@Component({
    selector: "ui-spinner",
    standalone: true,
    templateUrl: "./spinner.component.html",
    styleUrl: "./spinner.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    host: {
        "[class.absolute]": "absolute() !== false",
    },
})
export class SpinnerComponent {
    public readonly color = input<UIColor>("default");
    public readonly absolute = input<boolean | "">(false);
}
