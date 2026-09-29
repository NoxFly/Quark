/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
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
    selector: "ui-toggle",
    standalone: true,
    templateUrl: "./toggle.component.html",
    styleUrls: ["./toggle.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ToggleComponent), multi: true }],
    host: {
        "[class.has-focus]": "hasFocus()",
        "[class]": "'label-' + this.labelPlacement()",
        "[class.checked]": "checked()",
        "[class.arrow]": "this.labelLeft() !== undefined && this.labelRight() !== undefined",
    }
})
export class ToggleComponent implements ControlValueAccessor {
    public readonly labelLeft = input<string | undefined>(undefined);
    public readonly labelRight = input<string | undefined>(undefined);
    public readonly labelPlacement = input<"inline" | "block">("inline");
    public readonly checked = model<boolean>(false);
    public readonly isDisabled = model<boolean | "">(false);
    protected id = randomId();

    protected readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>("input");

    protected readonly hasFocus = signal<boolean>(false);

    // ---

    public onChange = (value: boolean): void => {};
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
        this.checked.set(value);
    }

    /**
     *
     */
    public valueChanged(value: boolean): void {
        this.onChange(value);
        this.checked.set(value);
    }

    /**
     *
     */
    public handleInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.checked.set(input.checked);
        this.onChange(this.checked());
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
        this.isDisabled.set(isDisabled);
    }

    /**
     *
     */
    public setFocus(): void {
        this.inputElement().nativeElement.focus();
    }

    // ---

    /**
     *
     */
    public toggle(): void {
        if (this.isDisabled() !== false) {
            return;
        }

        this.checked.set(!this.checked());
        this.onChange(this.checked());
    }
}
