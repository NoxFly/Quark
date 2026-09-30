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

import { Controller, inject, Post, type Request } from "@noxfly/noxus/main";
import type { R_ShareCreateBody, R_ShareOpenResponse } from "@shared/share";
import { ShareService } from "src/modules/share/share.service";

/**
 * Création et ouverture des fichiers de partage.
 */
@Controller()
export class ShareController {
    private readonly shares = inject(ShareService);

    /**
     * Crée un fichier de partage depuis un profil du coffre.
     * @returns `false` si l'utilisateur a annulé l'enregistrement.
     */
    @Post("create")
    public async create(request: Request): Promise<boolean> {
        return await this.shares.create(request.senderId, request.body as R_ShareCreateBody);
    }

    /**
     * Secret enregistré d'un profil, pour préremplir le dialogue de partage.
     * C'est la seule route qui renvoie un secret du coffre au renderer : le
     * dialogue l'affiche masqué, et il n'est demandé que pour un profil partageable.
     */
    @Post("profile-secret")
    public profileSecret(request: Request): string {
        const { profileId } = request.body as { profileId: string };
        return this.shares.profileSecret(profileId);
    }

    /**
     * Ouvre un fichier de partage dans la fenêtre appelante.
     */
    @Post("open")
    public async open(request: Request): Promise<R_ShareOpenResponse> {
        const { filePath, password } = request.body as { filePath: string; password: string };
        return await this.shares.open(request.senderId, filePath, password);
    }
}
