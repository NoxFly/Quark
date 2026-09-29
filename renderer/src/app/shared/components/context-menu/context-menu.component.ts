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
    inject,
    OnDestroy,
    signal,
} from "@angular/core";
import type { ContextMenuItem } from "./context-menu.types";

// Réexporté ici : les appelants importent le type depuis le composant.
export type { ContextMenuItem } from "./context-menu.types";

/**
 * Menu contextuel positionné au clic droit.
 */
@Component({
    selector: "app-context-menu",
    standalone: true,
    templateUrl: "./context-menu.component.html",
    styleUrl: "./context-menu.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(document:click)": "onDocumentClick()",
        // `open()` arrête la propagation : ce clic droit-ci vise donc un autre endroit.
        "(document:contextmenu)": "onDocumentClick()",
        "(document:keydown.escape)": "onEscape()",
    },
})
export class ContextMenuComponent implements OnDestroy {
    private readonly el = inject(ElementRef<HTMLElement>);

    protected readonly visible = signal<boolean>(false);
    protected readonly posX = signal<number>(0);
    protected readonly posY = signal<number>(0);
    protected readonly items = signal<ContextMenuItem[]>([]);
    protected readonly title = signal<string>("");

    /**
     * Ouvre le menu contextuel à la position donnée.
     * @param title En-tête facultatif du menu (nom de l'objet visé), en police mono.
     */
    public open(event: MouseEvent, items: ContextMenuItem[], title: string = ""): void {
        event.preventDefault();
        event.stopPropagation();

        this.items.set(items);
        this.title.set(title);
        this.posX.set(event.clientX);
        this.posY.set(event.clientY);
        this.visible.set(true);

        // Ajuster la position si le menu déborde de la fenêtre
        requestAnimationFrame(() => {
            const menu = this.el.nativeElement.querySelector(".context-menu") as HTMLElement;
            if (!menu) {
                return;
            }

            const rect = menu.getBoundingClientRect();
            let x = this.posX();
            let y = this.posY();

            if (x + rect.width > window.innerWidth) {
                x = window.innerWidth - rect.width - 4;
            }

            if (y + rect.height > window.innerHeight) {
                y = window.innerHeight - rect.height - 4;
            }

            this.posX.set(x);
            this.posY.set(y);
        });
    }

    /**
     * Ferme le menu contextuel.
     */
    public close(): void {
        this.visible.set(false);
    }

    /**
     * Exécute l'action d'un item et ferme le menu.
     */
    protected onItemClick(item: ContextMenuItem): void {
        if (item.disabled || item.separator) {
            return;
        }

        item.action();
        this.close();
    }

    /**
     * Un clic ailleurs referme le menu.
     */
    protected onDocumentClick(): void {
        if (this.visible()) {
            this.close();
        }
    }

    /**
     *
     */
    protected onEscape(): void {
        if (this.visible()) {
            this.close();
        }
    }

    public ngOnDestroy(): void {
        this.close();
    }
}
