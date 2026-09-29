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

import type { DatabaseDriverType } from "@shared/driver";

/**
 * Formulaire affiché sous les cartes de la page d'accueil pour un type de base :
 * - `file` : SQLite (fichier local ou URL distante) ;
 * - `uri` : chaîne de connexion complète (MongoDB) ;
 * - `server` : hôte / port / identifiants / base (serveurs relationnels).
 */
export type DriverFormKind = "file" | "uri" | "server";

/**
 * Présentation d'un type de base dans l'interface (carte de la page d'accueil,
 * vignette des bases récentes).
 */
export interface DriverPresentation {
    /** Driver ouvert par la carte. SQLite couvre aussi le mode distant (`libsql`). */
    type: DatabaseDriverType;
    /** Nom du produit (non traduit). */
    label: string;
    /** Monogramme affiché quand aucun logo n'existe (police mono). */
    monogram: string;
    /** Chemin du logo, `null` si le produit n'en a pas. */
    logo: string | null;
    /** Variable CSS de la teinte de la pastille (`--tint-<driver>`). */
    tint: string;
    /** Clé i18n de la description courte de la carte. */
    descriptionKey: string;
    /** Clé i18n de l'indication affichée à droite du titre du formulaire. */
    hintKey: string;
    /** Port proposé quand le driver ne fournit pas le sien. */
    defaultPort: number | null;
    /** Formulaire de connexion associé. */
    form: DriverFormKind;
}

/** Nom et adresse affichables d'une connexion ouverte par URI. */
export interface ConnectionUriDescription {
    /** Nom de la base, affiché comme titre. */
    database: string;
    /** Adresse sans identifiants ni paramètres. */
    address: string;
}
