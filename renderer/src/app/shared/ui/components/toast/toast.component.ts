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

import { ChangeDetectionStrategy, Component, computed, inject, input, model, OnDestroy, OnInit } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
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
        "[attr.data-toast-position]": "position() || 'bottom-right'",
        "[class.busy]": "busy()",
        "role": "status",
    }
})
export class ToastComponent extends UIComponent implements OnInit, OnDestroy {
    protected readonly i18n = inject(I18nService);

    public readonly message = model.required<string>();
    public readonly duration = input<number>();
    public readonly color = input<UIColor>();
    public readonly closable = input<boolean>();
    public readonly position = input<ToastPosition>();
    public readonly actions = input<UIAction[]>([]);
    /** Affiche le spinner de la maquette devant le message (opération en cours). */
    public readonly busy = input<boolean>(false);

    protected readonly hasActions = computed(() => this.actions().length > 0);
    protected readonly hasDuration = computed(() => this.duration() !== undefined);

    private durationTimer: ReturnType<typeof setTimeout> | undefined;

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
        const duration = this.duration();

        if (duration !== undefined) {
            this.ref.nativeElement.style.setProperty("--toast-duration", `${duration}ms`);
            this.ref.nativeElement.classList.add("ephemeral");

            // Minuteur plutôt que la fin de l'animation de la barre : n'importe quelle
            // autre animation du toast (spinner, apparition) aurait déclenché la fermeture.
            this.durationTimer = setTimeout(() => {
                if (!this.disappearing()) {
                    this.dismiss();
                }
            }, duration);
        }
    }

    /**
     *
     */
    public override ngOnDestroy(): void {
        clearTimeout(this.durationTimer);
        super.ngOnDestroy();
    }
}
