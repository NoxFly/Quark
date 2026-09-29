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

export function randomId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrait le message d'erreur lisible depuis une erreur Electron IPC.
 *
 * Electron préfixe systématiquement les erreurs avec
 * `Error invoking remote method '<channel>': ` puis le driver ajoute son propre
 * préfixe de type (`MongoServerError: `, `Error: `, etc.).
 * Cette fonction retire ces deux couches pour n'exposer que le message réel.
 *
 * @example
 * extractIpcErrorMessage("Error invoking remote method 'db-connect-network': MongoServerError: bad auth")
 * // => "bad auth"
 */
export function extractIpcErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    // Retire le préfixe IPC Electron
    const withoutIpc = raw.replace(/^Error invoking remote method '[^']+': /, "");
    // Retire le préfixe de type d'erreur (ex: "MongoServerError: ", "Error: ")
    return withoutIpc.replace(/^[A-Za-z]+Error: /, "");
}
