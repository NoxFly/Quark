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

import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { StateService } from "src/app/core/services/state.service";
import { UpdateService } from "src/app/core/services/update.service";
import { TranslatePipe } from "src/app/shared/pipes/translate.pipe";

/**
 * Modale « À propos de Quark » : version, plateforme, état de la mise à jour automatique.
 */
@Component({
    selector: "app-about",
    standalone: true,
    templateUrl: "./about.component.html",
    styleUrl: "./about.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe],
})
export class AboutComponent {
    protected readonly state = inject(StateService);
    private readonly updateService = inject(UpdateService);

    /** Callback de fermeture, fourni par l'ouvreur de la modale. */
    public dismiss?: () => void;

    protected readonly autoUpdate = computed<boolean>(() => this.updateService.settings().autoUpdate);

    /**
     * Plateforme d'exécution (« Windows x64 »). Le main ne la transmet pas : on la
     * lit dans l'agent utilisateur de Chromium, qui la porte sous Electron.
     */
    protected readonly platform: string = this.detectPlatform();

    protected close(): void {
        this.dismiss?.();
    }

    private detectPlatform(): string {
        const agent = navigator.userAgent;
        const os = agent.includes("Windows")
            ? "Windows"
            : agent.includes("Mac OS")
                ? "macOS"
                : agent.includes("Linux")
                    ? "Linux"
                    : "";
        const arch = /x64|x86_64|Win64|amd64/i.test(agent)
            ? "x64"
            : /arm64|aarch64/i.test(agent)
                ? "arm64"
                : "";

        return [os, arch].filter(part => part !== "").join(" ");
    }
}
