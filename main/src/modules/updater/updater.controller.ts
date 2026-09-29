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

import { Controller, Get, inject, Post, type Request } from "@noxfly/noxus/main";
import type { UpdateInfo, UpdateSettings } from "@shared/update";
import { UpdaterService } from "src/modules/updater/updater.service";

@Controller()
export class UpdaterController {
    private readonly updater = inject(UpdaterService);

    /**
     * Interroge le manifeste distant et retourne l'état de mise à jour.
     */
    @Get("check")
    public async check(): Promise<UpdateInfo> {
        return await this.updater.check();
    }

    /**
     * Retourne le résultat de la dernière recherche, sans requête réseau.
     */
    @Get("info")
    public getInfo(): UpdateInfo | null {
        return this.updater.getInfo();
    }

    @Get("settings")
    public getSettings(): UpdateSettings {
        return this.updater.getSettings();
    }

    /**
     * Active ou désactive l'installation automatique des mises à jour.
     */
    @Post("settings")
    public setSettings(request: Request): UpdateSettings {
        const { autoUpdate } = request.body as Pick<UpdateSettings, "autoUpdate">;
        return this.updater.setAutoUpdate(autoUpdate === true);
    }

    /**
     * Télécharge, vérifie et applique la mise à jour trouvée.
     */
    @Post("apply")
    public async apply(): Promise<void> {
        await this.updater.applyUpdate();
    }

    /**
     * Ouvre la page des releases dans le navigateur.
     */
    @Post("open-releases")
    public async openReleases(): Promise<void> {
        await this.updater.openReleasesPage();
    }
}
