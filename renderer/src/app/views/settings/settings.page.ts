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

import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from "@angular/core";
import type { Theme } from "@shared/preferences";
import { ButtonComponent } from "@ui/button/button.component";
import type { ConnectionTimeoutSeconds, GridDensity } from "src/app/core/models/settings.model";
import type { SegmentOption } from "src/app/core/models/shell.model";
import { ConnectionsService } from "src/app/core/services/connections.service";
import { I18nService, type SupportedLocale } from "src/app/core/services/i18n.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { ShellService } from "src/app/core/services/shell.service";
import { StateService } from "src/app/core/services/state.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { UpdateService } from "src/app/core/services/update.service";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";
import { IconComponent } from "src/app/shared/ui/components/icon/icon.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import { MasterPasswordDialogComponent } from "src/app/views/settings/master-password-dialog/master-password-dialog.component";

const LANGUAGE_OPTIONS: readonly SegmentOption<SupportedLocale>[] = [
    { value: "fr", labelKey: "Français", raw: true },
    { value: "en", labelKey: "English", raw: true },
];

const THEME_OPTIONS: readonly SegmentOption<Theme>[] = ThemeService.availableThemes.map(theme => ({
    value: theme.value,
    labelKey: theme.labelKey,
}));

const DENSITY_OPTIONS: readonly SegmentOption<GridDensity>[] = [
    { value: "compact", labelKey: "settings.density.compact" },
    { value: "normal", labelKey: "settings.density.normal" },
    { value: "comfort", labelKey: "settings.density.comfort" },
];

const TIMEOUT_OPTIONS: readonly SegmentOption<ConnectionTimeoutSeconds>[] = [
    { value: 10, labelKey: "10 s", raw: true },
    { value: 30, labelKey: "30 s", raw: true },
    { value: 60, labelKey: "60 s", raw: true },
];

/**
 * Page Paramètres, affichée par-dessus l'espace de travail (ou l'accueil) par
 * le bouton ⚙ de la titlebar. Chaque réglage est branché sur sa source de vérité :
 * `SettingsService` (interface), `ThemeService`, `I18nService`, `UpdateService`
 * et le coffre de connexions.
 */
@Component({
    selector: "app-settings",
    standalone: true,
    templateUrl: "./settings.page.html",
    styleUrl: "./settings.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent, TranslatePipe, IconComponent],
})
export class SettingsPage implements OnInit {
    protected readonly settingsService = inject(SettingsService);
    protected readonly themeService = inject(ThemeService);
    protected readonly i18n = inject(I18nService);
    protected readonly updateService = inject(UpdateService);
    protected readonly connections = inject(ConnectionsService);
    protected readonly state = inject(StateService);
    private readonly shell = inject(ShellService);
    private readonly modalCtrl = inject(ModalController);

    protected readonly languageOptions = LANGUAGE_OPTIONS;
    protected readonly themeOptions = THEME_OPTIONS;
    protected readonly densityOptions = DENSITY_OPTIONS;
    protected readonly timeoutOptions = TIMEOUT_OPTIONS;

    protected readonly settings = this.settingsService.settings;

    protected readonly masterPasswordEnabled = computed<boolean>(() => this.connections.status().masterPasswordEnabled);

    /** Dernière version publiée connue, si une recherche a déjà eu lieu. */
    protected readonly latestVersion = computed<string | null>(() => this.updateService.info()?.version ?? null);

    public ngOnInit(): void {
        // L'état du coffre n'est chargé qu'à l'ouverture du gestionnaire de connexions :
        // on le relit pour afficher le vrai état de l'interrupteur « Mot de passe maître ».
        void this.connections.refreshStatus().catch((error: unknown) => {
            console.error("Failed to read the connection vault status:", error);
        });
    }

    protected back(): void {
        this.shell.closeSettings();
    }

    protected label(option: SegmentOption<string | number>): string {
        return option.raw ? option.labelKey : this.i18n.t(option.labelKey);
    }

    protected setLocale(locale: SupportedLocale): void {
        this.i18n.setLocale(locale);
    }

    protected setTheme(theme: Theme): void {
        this.themeService.applyTheme(theme);
    }

    protected setDensity(density: GridDensity): void {
        this.settingsService.set("gridDensity", density);
    }

    protected setConnectionTimeout(timeout: ConnectionTimeoutSeconds): void {
        this.settingsService.set("connectionTimeout", timeout);
    }

    protected toggleAutoUpdate(): void {
        void this.updateService.toggleAutoUpdate();
    }

    protected checkUpdates(): void {
        void this.updateService.checkNow();
    }

    /**
     * Activer ou retirer le mot de passe maître exige une saisie : la bascule
     * passe par une petite modale et l'interrupteur ne suit qu'en cas de succès.
     */
    protected async toggleMasterPassword(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: MasterPasswordDialogComponent,
            componentProps: { enable: !this.masterPasswordEnabled() },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const component = modal.getComponentInstance<MasterPasswordDialogComponent>();

        if (component) {
            component.dismiss = () => modal.dismiss();
        }
    }
}
