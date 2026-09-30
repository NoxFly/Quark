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
 * Types de bases de données supportés.
 * Chaque valeur correspond à un driver spécifique.
 */
export type DatabaseDriverType =
    | "sqlite"
    /** SQLite distant (libSQL / Turso), présenté comme le mode « URL distante » de SQLite. */
    | "libsql"
    | "mysql"
    | "postgresql"
    | "oracle"
    | "mssql"
    | "azure"
    | "mongodb";

/**
 * Catégorie de base de données.
 * Détermine les fonctionnalités disponibles au niveau de l'UI et du driver.
 */
export type DatabaseCategory = "sql" | "nosql";

/**
 * Map driver → catégorie.
 */
export declare const DRIVER_CATEGORIES: Record<DatabaseDriverType, DatabaseCategory>;

/**
 * Décrit les capacités d'un driver de base de données.
 * Permet à l'UI de s'adapter dynamiquement selon le driver actif.
 */
export interface DriverCapabilities {
    /** Le driver supporte les transactions. */
    transactions: boolean;
    /** Le driver supporte la manipulation de schéma (ALTER TABLE, CREATE INDEX...). */
    schemaEditing: boolean;
    /** Le driver supporte les requêtes SQL arbitraires. */
    sqlQueries: boolean;
    /** Le driver supporte les foreign keys. */
    foreignKeys: boolean;
    /** Le driver supporte le chiffrement natif. */
    encryption: boolean;
    /** Le driver supporte les index. */
    indexes: boolean;
    /** Le driver supporte l'import/export de données. */
    importExport: boolean;
    /** Le driver supporte les diagrammes ER (entité-relation). */
    erDiagram: boolean;
    /** Le driver utilise des collections (NoSQL) plutôt que des tables. */
    collections: boolean;
    /** Le driver nécessite une connexion réseau (pas un fichier local). */
    networkConnection: boolean;
    /** Le driver supporte les procédures stockées. */
    storedProcedures: boolean;
}

/**
 * Configuration de connexion pour les drivers de type fichier (SQLite).
 */
export interface FileConnectionConfig {
    type: "file";
    filePath: string;
}

/**
 * Configuration de connexion pour les drivers réseau (MySQL, PostgreSQL, etc.).
 */
export interface NetworkConnectionConfig {
    type: "network";
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    /** Options spécifiques au driver (SSL, etc.). */
    options?: Record<string, unknown>;
}

/**
 * Options d'établissement d'une connexion, transmises au driver par
 * `configureConnection` avant `open`. Aucune n'est obligatoire : une option
 * absente conserve le comportement historique du driver.
 */
export interface DriverConnectionOptions {
    /** Chiffrer la connexion (SSL / TLS). Azure SQL l'impose quoi qu'il arrive. */
    ssl?: boolean;
    /** Délai avant abandon de l'établissement de la connexion, en secondes. */
    timeoutSeconds?: number;
    /** URI de connexion complète (MongoDB), prioritaire sur l'hôte et les identifiants. */
    uri?: string;
    /**
     * Jeton d'authentification (libSQL / Turso). Transmis à part plutôt que dans
     * l'URL ouverte : celle-ci devient le `path` du driver, affiché et historisé.
     */
    authToken?: string;
    /**
     * Connexion ouverte depuis un fichier de partage : l'hôte des drivers
     * n'écrit rien dans son journal tant qu'elle dure, les messages des clients
     * de bases citant souvent l'hôte, l'utilisateur ou la base.
     */
    confidential?: boolean;
    /** Authentification Azure SQL (ignorée par les autres drivers). */
    azureAuth?: {
        mode: import("./connection").AzureAuthMode;
        clientId?: string;
        tenantId?: string;
    };
}

/**
 * Union des configurations de connexion possibles.
 */
export type ConnectionConfig = FileConnectionConfig | NetworkConnectionConfig;

/**
 * Métadonnées d'un driver, exposées au renderer pour l'adaptation de l'UI.
 */
export interface DriverInfo {
    /** Identifiant technique du driver. */
    type: DatabaseDriverType;
    /** Catégorie du driver. */
    category: DatabaseCategory;
    /** Nom affiché dans l'UI. */
    displayName: string;
    /** Capacités supportées par ce driver. */
    capabilities: DriverCapabilities;
    /** Port par défaut pour les drivers réseau. */
    defaultPort?: number;
}
