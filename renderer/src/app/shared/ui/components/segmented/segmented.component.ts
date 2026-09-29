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

import { ChangeDetectionStrategy, Component, forwardRef, input, model } from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";
import { IconComponent } from "@ui/icon/icon.component";
import { TooltipDirective } from "@ui/tooltip/tooltip.directive";
import type { SegmentedOption, UIButtonSize } from "src/app/shared/ui/ui.types";

/**
 * Contrôle segmenté de la maquette (« Texte | SQL », « Fichier local | URL distante »,
 * choix des réglages) : une rangée de segments bordés, le segment actif sur fond accent.
 *
 * @example
 * ```html
 * <ui-segmented [options]="modes" [(value)]="mode" />
 * ```
 */
@Component({
    selector: "ui-segmented",
    standalone: true,
    templateUrl: "./segmented.component.html",
    styleUrl: "./segmented.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, TooltipDirective],
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SegmentedComponent), multi: true }],
    host: {
        "role": "radiogroup",
        "[attr.data-size]": "size()",
        "[class.disabled]": "disabled()",
    },
})
export class SegmentedComponent<T = string> implements ControlValueAccessor {
    public readonly options = input.required<SegmentedOption<T>[]>();
    public readonly value = model<T | null>(null);
    public readonly disabled = model<boolean>(false);
    /** 24 px (réglages), 28 px (barres d'outils), 32 px (formulaires). */
    public readonly size = input<UIButtonSize>("medium");

    private onChange: (value: T) => void = () => {};
    private onTouched: () => void = () => {};

    /**
     * Sélectionne un segment, sauf s'il est désactivé ou déjà actif.
     */
    protected select(option: SegmentedOption<T>): void {
        if (this.disabled() || option.disabled || option.value === this.value()) {
            return;
        }

        this.value.set(option.value);
        this.onChange(option.value);
        this.onTouched();
    }

    // --- ControlValueAccessor ---

    /**
     *
     */
    public writeValue(value: T | null): void {
        this.value.set(value);
    }

    /**
     *
     */
    public registerOnChange(fn: (value: T) => void): void {
        this.onChange = fn;
    }

    /**
     *
     */
    public registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    /**
     *
     */
    public setDisabledState(isDisabled: boolean): void {
        this.disabled.set(isDisabled);
    }
}
