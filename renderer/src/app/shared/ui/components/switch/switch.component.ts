/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    forwardRef,
    input,
    model,
    signal,
    viewChild
} from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";
import { randomId } from "src/app/shared/helpers/utils";

@Component({
    selector: "ui-switch",
    standalone: true,
    templateUrl: "./switch.component.html",
    styleUrls: ["./switch.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitchComponent), multi: true }],
    host: {
        "[class.has-focus]": "hasFocus()",
    }
})
export class SwitchComponent implements ControlValueAccessor {
    public readonly label = input<string | undefined>(undefined);
    public readonly value = model<boolean>(false);
    public readonly disabled = model<boolean>(false);

    protected id = randomId();

    protected readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>("input");

    protected readonly hasFocus = signal<boolean>(false);

    // ---

    /**
     *
     */
    protected toggle(): void {
        if (this.disabled()) {
            return;
        }

        const newValue = !this.value();

        this.valueChanged(newValue);
        this.inputElement().nativeElement.checked = newValue;
    }

    // ---

    public onChange = (value: any): void => {};
    public onTouched = (): void => {};

    /**
     *
     */
    public registerOnChange(fn: any): void {
        this.onChange = fn;
    }

    /**
     *
     */
    public registerOnTouched(fn: any): void {
        this.onTouched = fn;
    }

    // ---

    /**
     *
     */
    public writeValue(value: any): void {
        this.value.set(value);
    }

    /**
     *
     */
    public valueChanged(value: boolean): void {
        this.onChange(value);
        this.value.set(value);
    }

    /**
     *
     */
    public handleInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.value.set(input.checked);
        this.onChange(this.value());
    }

    /**
     *
     */
    public handleBlur(): void {
        this.hasFocus.set(false);
        this.onTouched();
    }

    /**
     *
     */
    public handleFocus(): void {
        this.hasFocus.set(true);
        this.onTouched();
    }

    // ---

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
        this.inputElement().nativeElement.focus();
    }
}
