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
    output,
    signal
} from "@angular/core";

@Component({
    selector: "ui-select-option",
    standalone: true,
    templateUrl: "./select-option.component.html",
    styleUrls: ["./select-option.component.scss"],
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.disabled]": "isDisabled()",
        "[class.hidden]": "hidden() !== false || filteredOut()",
        "[class.selected]": "isSelected()",
        "(click)": "onClick()",
    },
})
export class SelectOptionComponent {
    private readonly elementRef = inject(ElementRef<HTMLElement>);

    public readonly value = input<any>(null);
    public readonly icon = input<string>();
    public readonly default = input<boolean | "">(false);

    public readonly disabled = input<boolean | "">(false);
    public readonly hidden = input<boolean | "">(false);

    public readonly selected = signal<boolean>(false);
    public readonly filteredOut = signal<boolean>(false);

    public readonly isDisabled = signal<boolean>(false);
    public readonly isSelected = signal<boolean>(false);

    public optionSelected = output<SelectOptionComponent>();

    public readonly content = computed(() => this.elementRef.nativeElement.textContent || "");
    public readonly isDefaultSelected = computed(() => this.default() !== false);

    /**
     *
     */
    public constructor() {
        effect(() => (this.isDisabled.set(this.disabled() !== false)));
        effect(() => (this.isSelected.set(this.selected())));
    }

    /**
     *
     */
    public onClick(): void {
        this.optionSelected.emit(this);
    }
}
