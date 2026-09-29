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
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    computed,
    DOCUMENT,
    ElementRef,
    forwardRef,
    inject,
    input,
    model,
    numberAttribute,
    OnDestroy,
    output,
    signal,
    viewChild
} from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";
import { IconComponent } from "@ui/icon/icon.component";
import { randomId } from "src/app/shared/helpers/utils";

// https://developer.mozilla.org/fr/docs/Web/HTML/Reference/Attributes/autocomplete
type Autocomplete =
    | "off"
    | "on"
    // -- mot de passe
    | "new-password"
    | "current-password"
    | "one-time-code"
    // -- nom
    | "honorific-prefix"
    | "given-name"
    | "additional-name"
    | "family-name"
    | "honorific-suffix"
    | "nickname"
    // --
    | "email"
    | "username"
    // --
    | "organization-title"
    | "organization"
    // --
    | "street-address"
    | "address-line1"
    | "address-line2"
    | "address-line3"
    | "address-level4"
    | "address-level3"
    | "address-level2"
    | "address-level1"
    | "country"
    | "country-name"
    | "postal-code"
    // -- carte bancaire
    | "cc-name"
    | "cc-given-name"
    | "cc-additional-name"
    | "cc-family-name"
    | "cc-number"
    | "cc-exp"
    | "cc-exp-month"
    | "cc-exp-year"
    | "cc-csc"
    | "cc-type"
    // -- transaction
    | "transaction-currency"
    | "transaction-amount"
    // --
    | "language"
    | "bday"
    | "bday-day"
    | "bday-month"
    | "bday-year"
    | "sex"
    | "tel"
    | "tel-extension"
    | "impp"
    | "url"
    | "photo";

type InputType = "text" | "password" | "email" | "number" | "checkbox" | "radio" | "file" | "search" | "tel" | "url";
// ce composant ne gère pas les types suivants :
// hidden | date | time | datetime-local | month | week | color | range | image
// si implémenté, d'autres composants spécifiques à ces types devront être utilisés.

@Component({
    selector: "ui-input",
    standalone: true,
    templateUrl: "./input.component.html",
    styleUrls: ["./input.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true }],
    imports: [IconComponent],
    host: {
        "[attr.data-disabled]": "isDisabled() ? 'true' : null",
        "[class]": "'label-' + this.labelPlacement()",
        "[class.has-focus]": "hasFocus()",
        "[class.show-password]": "type() === 'password' && this.inputElement().nativeElement.type === 'text'",
    },
})
export class InputComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
    private readonly document = inject(DOCUMENT);
    private readonly elementRef = inject(ElementRef<HTMLElement>);
    private readonly cdr = inject(ChangeDetectorRef);

    public readonly type = input.required<InputType>();
    public readonly placeholder = input<string>("");
    public readonly togglePassword = input<boolean>(false);
    public readonly pattern = input<string>("");
    public readonly label = input<string | undefined>(undefined);
    public readonly labelPlacement = input<"fixed" | "floating" | "stacked">("fixed");
    public readonly autocomplete = input<Autocomplete>("off");
    public readonly value = model<string>("");
    public readonly isDisabled = model<boolean | "">(false);
    public readonly icon = input<string | undefined>(undefined);
    public readonly suggestions = model<string[]>([]); // disponible que pour le type "text"
    public readonly checked = model<boolean>(false); // radio et checkbox seulement

    // Contraintes numériques (type "number" uniquement).
    // `numberAttribute` coerce les attributs statiques (ex: min="5") en nombre.
    public readonly min = input<number | undefined, unknown>(undefined, { transform: v => v == null ? undefined : numberAttribute(v) });
    public readonly max = input<number | undefined, unknown>(undefined, { transform: v => v == null ? undefined : numberAttribute(v) });
    public readonly step = input<number, unknown>(1, { transform: v => numberAttribute(v, 1) });

    /** Vrai si la valeur courante a atteint le minimum (désactive le bouton "-"). */
    protected readonly atMin = computed<boolean>(() => {
        const min = this.min();
        if (min === undefined) {
            return false;
        }
        const parsed = Number.parseFloat(this.value());
        return Number.isFinite(parsed) && parsed <= min;
    });

    /** Vrai si la valeur courante a atteint le maximum (désactive le bouton "+"). */
    protected readonly atMax = computed<boolean>(() => {
        const max = this.max();
        if (max === undefined) {
            return false;
        }
        const parsed = Number.parseFloat(this.value());
        return Number.isFinite(parsed) && parsed >= max;
    });

    protected id = randomId();

    protected readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>("input");

    protected readonly pickSuggestion = output<string>();
    /* Déclenché seulement au blur (défocus) de l'input, si la valeur a changé */
    public readonly selfChange = output<InputComponent>();

    protected readonly hasFocus = signal<boolean>(false);

    private readonly _blurController: AbortController = new AbortController();

    private lastFocusValue: string = "";

    /**
     *
     */
    public get input(): HTMLInputElement {
        return this.inputElement().nativeElement;
    }

    // ---


    // ---

    /**
     *
     */
    public onChange = (value: any): void => {};

    /**
     *
     */
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
    public valueChanged(value: string): void {
        this.value.set(value);
        this.onChange(value);
    }

    /**
     *
     */
    public handleInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.setValue(input.value);
    }

    // ---

    /**
     *
     */
    public setDisabledState(isDisabled: boolean): void {
        this.isDisabled.set(isDisabled);
        this.cdr.markForCheck();
    }

    /**
     *
     */
    public setFocus(): void {
        this.inputElement().nativeElement.focus();

        // S'assurer que le changement est pris en compte
        setTimeout(() => {
            if (this.document.activeElement === this.inputElement().nativeElement) {
                this.hasFocus.set(true);
                this.cdr.markForCheck();
            }
        }, 0);
    }

    /**
     *
     */
    public setValue(value: string): void {
        this.value.set(value);
        this.onChange(value);
    }

    /**
     *
     */
    protected selectSuggestion(proposition: string): void {
        this.writeValue(proposition);
        this.suggestions.set([]);
        this.pickSuggestion.emit(proposition);
        this.hasFocus.set(false);
    }

    // ---

    /**
     * Incrémente la valeur numérique d'un pas (bouton "+").
     */
    protected increment(): void {
        this.stepValue(1);
    }

    /**
     * Décrémente la valeur numérique d'un pas (bouton "-").
     */
    protected decrement(): void {
        this.stepValue(-1);
    }

    /**
     * Applique un pas à la valeur numérique en respectant `min`, `max` et `step`.
     */
    private stepValue(direction: 1 | -1): void {
        if (this.isDisabled() !== false) {
            return;
        }

        const step = this.step() > 0 ? this.step() : 1;
        const min = this.min();
        const max = this.max();

        const parsed = Number.parseFloat(this.value());
        const current = Number.isFinite(parsed) ? parsed : (min ?? 0);

        let next = current + direction * step;

        if (min !== undefined && next < min) {
            next = min;
        }
        if (max !== undefined && next > max) {
            next = max;
        }

        this.setValue(String(this.normalizeToStep(next, step)));
        this.inputElement().nativeElement.focus();
    }

    /**
     * Arrondit à la précision décimale du pas pour éviter les imprécisions
     * de l'arithmétique flottante (ex: 0.1 + 0.2).
     */
    private normalizeToStep(value: number, step: number): number {
        const decimals = (String(step).split(".")[1] ?? "").length;
        return decimals > 0 ? Number(value.toFixed(decimals)) : value;
    }

    /**
     *
     */
    protected togglePasswordVisibility(): void {
        const input = this.inputElement().nativeElement;

        input.type = input.type === "text" ? "password" : "text";
    }

    /**
     *
     */
    public ngOnDestroy(): void {
        this._blurController.abort();
    }

    /**
     *
     */
    public ngAfterViewInit(): void {
        const host = this.elementRef.nativeElement;

        // Gérer le focus quand l'input reçoit le focus (programmatiquement ou par clic)
        host.addEventListener(
            "focusin",
            () => {
                this.hasFocus.set(true);
                this.lastFocusValue = this.value();
                this.cdr.markForCheck(); // Forcer la détection de changements
            },
            { signal: this._blurController.signal },
        );

        // Gérer le blur quand le focus sort du composant
        host.addEventListener(
            "focusout",
            (event: FocusEvent) => {
                const nextTarget = event.relatedTarget as Node | null;

                if (!nextTarget || !host.contains(nextTarget)) {
                    this.hasFocus.set(false);

                    if(this.lastFocusValue !== this.value()) {
                        this.selfChange.emit(this);
                    }

                    this.cdr.markForCheck(); // Forcer la détection de changements
                }
            },
            { signal: this._blurController.signal },
        );
    }
}
