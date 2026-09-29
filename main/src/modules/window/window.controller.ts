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
import type { LoadAppResult, TitlebarState } from "@shared/ipc-renderer";
import type { R_WindowStateResponse } from "@shared/types";
import { withTimeout } from "src/core/helpers/async.helper";
import { Application } from "src/modules/application";

/** Échéance de lecture du schéma sur le chemin de démarrage du renderer. */
const SCHEMA_LOAD_TIMEOUT_MS = 10_000;

const NO_TITLEBAR: TitlebarState = { minimizable: false, maximizable: false, closable: false };

/**
 * Cycle de vie et chrome de la fenêtre appelante (titlebar personnalisée).
 */
@Controller()
export class WindowController {
    private readonly application = inject(Application);

    /**
     * Informations de démarrage du renderer.
     */
    @Get("load")
    public load(request: Request): LoadAppResult {
        return this.application.getLoadAppResult(request.senderId);
    }

    /**
     * État de la connexion de la fenêtre, pour la restaurer après un rechargement.
     */
    @Get("state")
    public async getState(request: Request): Promise<R_WindowStateResponse> {
        const window = this.application.getWindowBySenderId(request.senderId);

        if (!window) {
            return { inTransaction: false, selectedTable: null, database: null, filePath: null, driverType: null, driverInfo: null };
        }

        const db = window.database;
        // Cette requête est sur le chemin de démarrage : elle ne doit jamais
        // pouvoir retenir le renderer indéfiniment.
        const schema = db.isOpen
            ? await withTimeout(db.getSchema(), SCHEMA_LOAD_TIMEOUT_MS, null, "window/state getSchema")
            : null;

        return {
            inTransaction: db.isInTransaction,
            // La table sélectionnée est un état du renderer uniquement.
            selectedTable: null,
            database: schema,
            filePath: db.path,
            driverType: db.driverType,
            driverInfo: db.info,
        };
    }

    @Get("titlebar-state")
    public getTitlebarState(request: Request): TitlebarState {
        return this.application.getWindowBySenderId(request.senderId)?.getTitlebarState() ?? NO_TITLEBAR;
    }

    @Post("close")
    public async close(request: Request): Promise<void> {
        await this.application.closeWindow(request.senderId);
    }

    @Post("new")
    public async newWindow(): Promise<void> {
        await this.application.openNewWindow();
    }

    @Post("quit")
    public async quit(): Promise<void> {
        await this.application.quit();
    }

    @Post("minimize")
    public minimize(request: Request): void {
        this.application.getWindowBySenderId(request.senderId)?.reduce();
    }

    @Post("toggle-maximize")
    public toggleMaximize(request: Request): void {
        this.application.getWindowBySenderId(request.senderId)?.toggleMaximize();
    }

    @Post("toggle-fullscreen")
    public toggleFullscreen(request: Request): void {
        this.application.getWindowBySenderId(request.senderId)?.toggleFullscreen();
    }

    @Post("reload")
    public async reload(request: Request): Promise<void> {
        await this.application.getWindowBySenderId(request.senderId)?.reloadRenderer();
    }

    /**
     * Dialogue natif de sélection d'une base SQLite.
     */
    @Get("open-file-dialog")
    public async openFileDialog(request: Request): Promise<string | null> {
        const window = this.application.getWindowBySenderId(request.senderId);
        return await this.application.openFileDialog(window?.browserWindow);
    }
}
