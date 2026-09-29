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
    inject,
    signal,
    OnInit,
    OnDestroy,
} from "@angular/core";
import { ThemeService } from "src/app/core/services/theme.service";
import type { Theme } from "@shared/preferences";

/**
 * Action sheet pour sélectionner le thème visuel.
 * S'ouvre via l'événement personnalisé `open-theme-picker` sur le document.
 * Navigation clavier : flèches haut/bas, Enter pour confirmer, Escape pour annuler.
 */
@Component({
    selector: "app-theme-picker",
    standalone: true,
    templateUrl: "./theme-picker.component.html",
    styleUrl: "./theme-picker.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(window:keydown)": "onKeydown($event)",
        "(click)": "close()",
    },
})
export class ThemePickerComponent implements OnInit, OnDestroy {
    private readonly themeService = inject(ThemeService);

    protected readonly isOpen = signal<boolean>(false);
    protected readonly selectedIndex = signal<number>(0);
    protected readonly themes = ThemeService.availableThemes;

    private previousTheme: Theme = "system";
    private readonly openHandler = (): void => this.open();

    public ngOnInit(): void {
        document.addEventListener("open-theme-picker", this.openHandler);
    }

    public ngOnDestroy(): void {
        document.removeEventListener("open-theme-picker", this.openHandler);
    }

    /**
     * Ouvre le sélecteur de thème.
     */
    private open(): void {
        this.previousTheme = this.themeService.currentTheme();
        const currentIndex = this.themes.findIndex(t => t.value === this.previousTheme);
        this.selectedIndex.set(currentIndex >= 0 ? currentIndex : 0);
        this.isOpen.set(true);
    }

    /**
     * Ferme le sélecteur sans appliquer.
     */
    protected close(): void {
        if (!this.isOpen()) {
            return;
        }
        // Revert to previous theme
        this.themeService.applyTheme(this.previousTheme);
        this.isOpen.set(false);
    }

    /**
     * Confirme la sélection courante.
     */
    protected confirm(): void {
        // Le thème est déjà appliqué en preview, il suffit de fermer
        this.isOpen.set(false);
    }

    /**
     * Sélectionne un thème par index et l'applique en preview.
     */
    protected selectTheme(event: MouseEvent, index: number): void {
        event.stopPropagation();
        this.selectedIndex.set(index);
        const theme = this.themes[index];
        if (theme) {
            this.themeService.applyTheme(theme.value);
        }
        this.confirm();
    }

    /**
     * Applique le thème correspondant à l'index sélectionné.
     */
    private applySelectedTheme(): void {
        const theme = this.themes[this.selectedIndex()];
        if (theme) {
            this.themeService.applyTheme(theme.value);
        }
    }

    /**
     * Gère la navigation clavier dans la liste.
     */
    protected onKeydown(event: KeyboardEvent): void {
        if (!this.isOpen()) {
            return;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.selectedIndex.update(i => Math.min(i + 1, this.themes.length - 1));
                this.applySelectedTheme();
                break;
            case "ArrowUp":
                event.preventDefault();
                this.selectedIndex.update(i => Math.max(i - 1, 0));
                this.applySelectedTheme();
                break;
            case "Enter":
                event.preventDefault();
                this.confirm();
                break;
            case "Escape":
                event.preventDefault();
                this.close();
                break;
        }
    }
}
