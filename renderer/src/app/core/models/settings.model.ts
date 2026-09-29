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

/** Densité de la grille de données : fixe la hauteur des lignes. */
export type GridDensity = "compact" | "normal" | "comfort";

/** Délai de connexion proposé dans les paramètres, en secondes. */
export type ConnectionTimeoutSeconds = 10 | 30 | 60;

/**
 * Réglages de l'interface propres au renderer (page Paramètres).
 *
 * Le thème (`ThemeService`), la langue (`I18nService`), la mise à jour automatique
 * (`UpdateService`) et le mot de passe maître du coffre (`ConnectionsService`) ont
 * leur propre source de vérité et n'y figurent pas.
 */
export interface AppSettings {
    /** Ouvrir les bases en mode édition plutôt qu'en lecture seule. */
    editModeOnStart: boolean;
    /** Demander confirmation avant un DELETE / DROP / vidage de table. */
    confirmDeletions: boolean;
    /** Démarrer une transaction à la première modification, jusqu'à validation explicite. */
    autoTransaction: boolean;
    /** Afficher par défaut les colonnes INTEGER horodatées comme des dates. */
    timestampsAsDates: boolean;
    /** Hauteur des lignes de la grille. */
    gridDensity: GridDensity;
    /** Cocher SSL / TLS par défaut sur les nouvelles connexions serveur. */
    sslByDefault: boolean;
    /** Délai avant abandon d'une connexion réseau. */
    connectionTimeout: ConnectionTimeoutSeconds;
}
