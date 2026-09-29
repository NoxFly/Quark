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
