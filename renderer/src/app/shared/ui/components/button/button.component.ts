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

    public readonly type = input<ButtonType>("button");
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
