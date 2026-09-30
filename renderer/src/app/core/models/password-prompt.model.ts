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

/**
 * Variante de la modale de mot de passe :
 * - `encrypted-file` : base SQLite chiffrée en attente de déverrouillage (`state.needsPassword`) ;
 * - `credentials` : reconnexion depuis l'historique à une base réseau ou distante
 *   dont le secret n'est pas conservé ;
 * - `share` : ouverture d'un fichier de partage, par son mot de passe de partage.
 */
export type PasswordPromptMode = "encrypted-file" | "credentials" | "share";
