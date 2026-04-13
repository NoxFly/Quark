/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    model,
    OnInit,
    signal,
    viewChild
} from "@angular/core";
import { IconComponent } from "@ui/icon/icon.component";
import { ExtendedUIColor } from "src/app/shared/ui/ui.types";

export type ButtonType = "button" | "submit" | "reset";

@Component({
    selector: "ui-button",
    standalone: true,
    templateUrl: "./button.component.html",
    styleUrls: ["./button.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent],
    host: {
        "[class.no-text]": "!hasText()",
    }
})
export class ButtonComponent implements OnInit {
    private readonly elementRef = inject(ElementRef<HTMLElement>);

    public readonly type = input.required<ButtonType>();
    public readonly color = input<ExtendedUIColor>("default");
    public readonly disabled = model<boolean>(false);
    public readonly icon = input<string | null>(null);
    public readonly iconPosition = input<"left" | "right">("left");
    public readonly link = input<string | null>(null);

    protected readonly buttonElement = viewChild.required<ElementRef<HTMLButtonElement>>("button");

    protected readonly hasText = computed(() => this.text().trim().length > 0);
    protected readonly text = signal<string>("");

    // ---

    /**
     *
     */
    public constructor() {
        effect(() => {
            this.buttonElement().nativeElement.disabled = this.disabled();

            const ref = this.elementRef.nativeElement;

            if (this.disabled()) {
                ref.setAttribute("disabled", "true");
            } else {
                ref.removeAttribute("disabled");
            }
        });
    }

    /**
     *
     */
    public setDisabledState(isDisabled: boolean): void {
        this.disabled.set(isDisabled);
    }

    /**
     *
     */
    public setFocus(): void {
        this.buttonElement().nativeElement.focus();
    }

    /**
     *
     */
    public ngOnInit(): void {
        this.text.set(this.elementRef.nativeElement.textContent?.trim() ?? "");
    }
}
