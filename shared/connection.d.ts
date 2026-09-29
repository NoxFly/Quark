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
 * Types partagés du système de connexions sauvegardées.
 *
 * Un profil de connexion représente une base administrée par l'utilisateur,
 * persistée dans un coffre XML chiffré (déverrouillé par un mot de passe maître).
 * Les profils peuvent être exportés en fichier XML chiffré par une passphrase
 * pour partager l'accès à une base sans divulguer les identifiants.
 */

import type { DatabaseDriverType } from "./driver";

/** Mode de connexion d'un profil : fichier local (SQLite) ou serveur réseau. */
export type ConnectionType = "file" | "network";

/**
 * Mode d'authentification d'une connexion Azure SQL.
 * - `sql` : authentification SQL Server (login / mot de passe de la base).
 * - `service-principal` : authentification Microsoft Entra ID via un principal
 *   de service (application Azure AD) : `clientId` + `clientSecret` + `tenantId`.
 *   Aucun identifiant utilisateur n'est requis ni transmis.
 */
export type AzureAuthMode = "sql" | "service-principal";

/**
 * Profil de connexion exposé au renderer.
 * Ne contient JAMAIS le secret (mot de passe) : il reste côté main.
 */
export interface ConnectionProfile {
    /** Identifiant unique (UUID). */
    id: string;
    /** Nom affiché du profil. */
    name: string;
    /** Couleur d'accent optionnelle (hex). */
    color?: string;
    /** Driver de la base. */
    driverType: DatabaseDriverType;
    /** Mode de connexion. */
    connectionType: ConnectionType;
    /** Chemin du fichier (connexion fichier). */
    filePath?: string;
    /** Hôte du serveur (connexion réseau). */
    host?: string;
    /** Port du serveur (connexion réseau). */
    port?: number;
    /** Nom d'utilisateur (connexion réseau). */
    username?: string;
    /** Nom de la base (connexion réseau). */
    database?: string;
    /** Mode d'authentification (Azure SQL uniquement ; défaut `sql`). */
    authMode?: AzureAuthMode;
    /** Client (application) ID Azure AD — requis pour `service-principal`. */
    clientId?: string;
    /** Tenant (directory) ID Azure AD — requis pour `service-principal`. */
    tenantId?: string;
    /** Indique qu'un mot de passe est stocké pour ce profil (jamais sa valeur). */
    hasPassword: boolean;
    /** Timestamp de création. */
    createdAt: number;
    /** Timestamp de dernière modification. */
    updatedAt: number;
}

/**
 * Données fournies par le renderer pour créer ou modifier un profil.
 * Le mot de passe est « write-only » : en modification, une valeur absente
 * (`undefined`) signifie « ne pas changer le mot de passe existant ».
 */
export interface ConnectionProfileInput {
    name: string;
    color?: string;
    driverType: DatabaseDriverType;
    connectionType: ConnectionType;
    filePath?: string;
    host?: string;
    port?: number;
    username?: string;
    database?: string;
    authMode?: AzureAuthMode;
    clientId?: string;
    tenantId?: string;
    /** Secret à enregistrer. `undefined` = inchangé (en update) ; "" = aucun mot de passe. */
    password?: string;
}

/** État du coffre de connexions renvoyé par le main. */
export interface ConnectionVaultStatus {
    /** Le coffre existe déjà (un mot de passe maître a été défini). */
    initialized: boolean;
    /** Le coffre est déverrouillé pour la session courante. */
    unlocked: boolean;
}

/** Résultat d'une tentative de connexion à un profil (mêmes champs que l'ouverture DB). */
export interface ConnectionConnectResult {
    /** La connexion nécessite encore un mot de passe (fichier chiffré sans secret stocké). */
    needsPassword: boolean;
    /**
     * Schéma chargé pour les connexions fichier déjà ouvertes.
     * `null` pour une connexion réseau (le schéma est chargé en arrière-plan par
     * le renderer) ou lorsqu'un mot de passe est encore requis.
     */
    database: import("./types").DatabaseSchema | null;
}
