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
 * Identifiants des étiquettes fournies par l'application. Elles sont créées dans
 * chaque coffre, puis modifiables et supprimables comme les autres ; tant que leur
 * nom n'est pas personnalisé, l'interface l'affiche traduit.
 */
export type BuiltinConnectionTagId = "production" | "client" | "local" | "other";

/**
 * Étiquette du gestionnaire, affichée en pastille de couleur. Rangée dans le
 * coffre, avec les dossiers.
 */
export interface ConnectionTagDef {
    /** Identifiant : celui d'une étiquette fournie, ou un UUID. */
    id: string;
    /** Nom affiché ; absent pour une étiquette fournie dont le nom n'a pas changé. */
    name?: string;
    /**
     * Couleur `#rrggbb` ; absente pour une étiquette fournie non personnalisée,
     * qui suit alors la couleur du thème (danger, avertissement, succès, accent).
     */
    color?: string;
    /** Ordre d'affichage (croissant). */
    order: number;
}

/** Données fournies pour créer ou modifier une étiquette. */
export interface ConnectionTagInput {
    name?: string;
    color?: string;
}

/**
 * Source d'une base SQLite : fichier local, ou base servie à distance (libSQL / Turso,
 * `https://`, `libsql://`, `wss://`). Le jeton d'authentification d'une base distante
 * est rangé dans le champ secret du profil (`password`).
 */
export type SqliteSourceMode = "file" | "url";

/**
 * Dossier du gestionnaire de connexions. Un profil sans `folderId` (ou dont le
 * dossier n'existe plus) est rangé dans le premier dossier par l'interface.
 */
export interface ConnectionFolder {
    /** Identifiant unique (UUID). */
    id: string;
    /** Nom affiché. */
    name: string;
    /** Ordre d'affichage (croissant). */
    order: number;
}

/** Données fournies pour créer ou renommer un dossier. */
export interface ConnectionFolderInput {
    name: string;
}

/**
 * Résultat d'un test de connexion (bouton « Tester »). Le test ouvre puis referme
 * une connexion éphémère, sans toucher à la base ouverte dans la fenêtre.
 */
export interface ConnectionTestResult {
    ok: boolean;
    /** Durée de l'établissement de la connexion, en millisecondes (si `ok`). */
    latencyMs?: number;
    /** Message d'erreur du driver (si `!ok`). */
    error?: string;
}

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
    /** Source SQLite : fichier (`filePath`) ou URL distante (`url`). Défaut `file`. */
    sqliteMode?: SqliteSourceMode;
    /** URL d'une base SQLite distante (libSQL / Turso). */
    url?: string;
    /** URI de connexion complète (MongoDB). Prioritaire sur hôte / port quand renseignée. */
    uri?: string;
    /** Chiffrer la connexion réseau (SSL / TLS). */
    ssl?: boolean;
    /** Dossier de rangement. */
    folderId?: string;
    /** Étiquette (identifiant d'une `ConnectionTagDef`). */
    tag?: string;
    /**
     * Position dans son dossier (croissante), fixée par un glisser-déposer. Absente,
     * le profil suit ceux qui en ont une, par ordre alphabétique.
     */
    order?: number;
    /** Notes libres. */
    notes?: string;
    /** Indique qu'un mot de passe est stocké pour ce profil (jamais sa valeur). */
    hasPassword: boolean;
    /** Timestamp de création. */
    createdAt: number;
    /** Timestamp de dernière modification. */
    updatedAt: number;
    /** Timestamp de la dernière connexion réussie via le gestionnaire (absent : jamais). */
    lastConnectedAt?: number;
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
    sqliteMode?: SqliteSourceMode;
    url?: string;
    uri?: string;
    ssl?: boolean;
    folderId?: string;
    tag?: string;
    notes?: string;
    /** Secret à enregistrer. `undefined` = inchangé (en update) ; "" = aucun mot de passe. */
    password?: string;
}

/** État du coffre de connexions renvoyé par le main. */
export interface ConnectionVaultStatus {
    /** Le coffre existe déjà (un mot de passe maître a été défini). */
    initialized: boolean;
    /** Le coffre est déverrouillé pour la session courante. */
    unlocked: boolean;
    /**
     * Le coffre est protégé par un mot de passe maître. À `false`, sa clé est
     * protégée par le trousseau du système (`safeStorage`) et il se déverrouille
     * sans saisie. Réglage « Mot de passe maître » des paramètres.
     */
    masterPasswordEnabled: boolean;
}

/**
 * Bascule de la protection du coffre (réglage « Mot de passe maître »).
 * - activer : `enabled: true` + `masterPassword` (nouveau mot de passe maître) ;
 * - désactiver : `enabled: false` + `masterPassword` (mot de passe actuel, pour confirmer).
 */
export interface ConnectionMasterPasswordBody {
    enabled: boolean;
    masterPassword: string;
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
