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

import { ChangeDetectionStrategy, Component, computed, input, model, OnInit } from "@angular/core";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";
import type { ToastPosition, UIAction, UIColor } from "src/app/shared/ui/ui.types";

@Component({
    selector: "ui-toast",
    standalone: true,
    templateUrl: "./toast.component.html",
    styleUrls: ["./toast.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[attr.data-toast-type]": "color() || 'medium'",
        "[attr.data-toast-position]": "position() || 'top-center'",
    }
})
export class ToastComponent extends UIComponent implements OnInit {
    public readonly message = model.required<string>();
    public readonly duration = input<number>();
    public readonly color = input<UIColor>();
    public readonly closable = input<boolean>();
    public readonly position = input<ToastPosition>();
    public readonly actions = input<UIAction[]>([]);

    protected readonly hasActions = computed(() => this.actions().length > 0);
    protected readonly hasDuration = computed(() => this.duration() !== undefined);

    /**
     *
     */
    protected close(): void {
        this.dismiss();
    }

    /**
     *
     */
    public ngOnInit(): void {
        if (this.hasDuration()) {
            this.ref.nativeElement.style.setProperty("--toast-duration", `${this.duration()}ms`);
            this.ref.nativeElement.classList.add("ephemeral");

            this.ref.nativeElement.addEventListener(
                "animationend",
                () => {
                    this.dismiss();
                },
                { once: true },
            );
        }
    }
}
