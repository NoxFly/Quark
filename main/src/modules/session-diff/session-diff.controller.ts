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

import { BadRequestException, Controller, Get, inject, Post, type Request } from "@noxfly/noxus/main";
import type {
    R_SessionRevertAllBody,
    R_SessionRevertBody,
    SessionDiffSnapshot,
    SessionDiffSummary,
    SessionRevertResult,
    SessionRowRef,
} from "@shared/session-diff";
import { Application } from "src/modules/application";

/** Instantané renvoyé quand la fenêtre n'a aucune connexion suivie. */
const EMPTY_SNAPSHOT: SessionDiffSnapshot = {
    active: false,
    startedAt: null,
    source: null,
    tables: [],
    opaque: [],
    summary: { tables: 0, rows: 0, opaque: 0 },
    capped: false,
};

@Controller()
export class SessionDiffController {
    private readonly application = inject(Application);

    /**
     * Retourne le diff complet de la session de connexion de la fenêtre appelante.
     */
    @Get("snapshot")
    public getSnapshot(request: Request): SessionDiffSnapshot {
        const window = this.application.getWindowBySenderId(request.senderId);

        return window?.sessionDiff.getSnapshot() ?? EMPTY_SNAPSHOT;
    }

    /**
     * Retourne les seuls compteurs du diff, pour un badge ou un indicateur.
     */
    @Get("summary")
    public getSummary(request: Request): SessionDiffSummary {
        const window = this.application.getWindowBySenderId(request.senderId);

        return window?.sessionDiff.getSummary() ?? EMPTY_SNAPSHOT.summary;
    }

    /**
     * Efface le journal sans toucher à la base.
     *
     * Redéfinit le point de référence du diff sur l'état actuel : utile après
     * avoir constaté et validé un lot de modifications.
     */
    @Post("clear")
    public clear(request: Request): SessionDiffSummary {
        const window = this.application.getWindowBySenderId(request.senderId);

        window?.restartDiffSession();

        return window?.sessionDiff.getSummary() ?? EMPTY_SNAPSHOT.summary;
    }

    /**
     * Remet une ligne du diff dans son état d'origine (restaure les valeurs
     * d'une modification, supprime une ligne insérée, réinsère une ligne
     * supprimée). Les entrées opaques ne sont pas annulables.
     */
    @Post("revert")
    public async revert(request: Request): Promise<SessionRevertResult> {
        const body = request.body as R_SessionRevertBody;

        if (!isRowRef(body)) {
            throw new BadRequestException("Invalid revert request");
        }

        return await this.application.requireWindow(request.senderId).revertSessionRow(body);
    }

    /**
     * Remet dans leur état d'origine les lignes désignées du diff (toutes si
     * rien n'est désigné), dans l'ordre des clés étrangères et, si possible,
     * dans une transaction : tout ou rien.
     */
    @Post("revert-all")
    public async revertAll(request: Request): Promise<SessionRevertResult> {
        const body = (request.body ?? {}) as R_SessionRevertAllBody;
        const rows = Array.isArray(body.rows) ? body.rows.filter(isRowRef) : undefined;
        const tables = Array.isArray(body.tables) ? body.tables.filter(table => typeof table === "string") : undefined;

        return await this.application.requireWindow(request.senderId).revertSessionRows(rows, tables);
    }
}

/**
 * Vérifie la forme d'une référence de ligne venue du renderer.
 */
function isRowRef(value: unknown): value is SessionRowRef {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const ref = value as Partial<SessionRowRef>;

    return typeof ref.table === "string" && (typeof ref.rowid === "number" || typeof ref.rowid === "string");
}
