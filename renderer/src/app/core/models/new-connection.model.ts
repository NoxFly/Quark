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

import type { AzureAuthMode, SqliteSourceMode } from "@shared/connection";

/**
 * Saisie du formulaire « Nouvelle connexion » de la page d'accueil.
 * Tous les champs existent quel que soit le type : seuls ceux du formulaire
 * affiché (`DriverFormKind`) sont lus.
 */
export interface NewConnectionDraft {
    /** SQLite : fichier local ou URL distante (libSQL). */
    sqliteMode: SqliteSourceMode;
    filePath: string;
    url: string;
    /** Jeton d'une base SQLite distante (optionnel). */
    authToken: string;
    /** URI complète (MongoDB). */
    uri: string;
    host: string;
    port: number;
    username: string;
    /** Mot de passe, ou secret client en mode principal de service Azure. */
    password: string;
    database: string;
    ssl: boolean;
    /** Azure SQL uniquement. */
    authMode: AzureAuthMode;
    clientId: string;
    tenantId: string;
}

/**
 * Champs texte libre du brouillon, alimentés directement par un `<input>`
 * (les unions comme `sqliteMode` en sont exclues : `string` ne leur est pas assignable).
 */
export type NewConnectionTextField = {
    [K in keyof NewConnectionDraft]: string extends NewConnectionDraft[K] ? K : never;
}[keyof NewConnectionDraft];
