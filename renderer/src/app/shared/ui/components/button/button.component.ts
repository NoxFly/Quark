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
    effect,
    ElementRef,
    inject,
    input,
    model,
    viewChild
} from "@angular/core";
import { IconComponent } from "@ui/icon/icon.component";
import { ExtendedUIColor, UIButtonFill, UIButtonSize } from "src/app/shared/ui/ui.types";

export type ButtonType = "button" | "submit" | "reset";

@Component({
    selector: "ui-button",
    standalone: true,
    templateUrl: "./button.component.html",
    styleUrls: ["./button.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent],
})
export class ButtonComponent {
    private readonly elementRef = inject(ElementRef<HTMLElement>);

    public readonly type = input<ButtonType>("button");
    public readonly color = input<ExtendedUIColor>("default");
    /** `clear` + `danger` = bouton « Supprimer » discret de la maquette. */
    public readonly fill = input<UIButtonFill>("solid");
    public readonly size = input<UIButtonSize>("medium");
    public readonly disabled = model<boolean>(false);
    public readonly icon = input<string | null>(null);
    public readonly iconPosition = input<"left" | "right">("left");
    public readonly link = input<string | null>(null);

    protected readonly buttonElement = viewChild.required<ElementRef<HTMLButtonElement>>("button");


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
}
