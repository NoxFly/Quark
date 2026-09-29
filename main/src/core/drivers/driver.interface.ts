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

import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    IndexDef,
    R_AlterTableAction,
    R_SqlExecResponse,
} from "@shared/types";
import type {
    DatabaseCategory,
    DatabaseDriverType,
    DriverCapabilities,
    DriverConnectionOptions,
    DriverInfo,
} from "@shared/driver";

/**
 * Contrat abstrait que tout driver de base de données doit implémenter.
 * Définit les opérations fondamentales communes à tous les types de bases.
 *
 * Toutes les méthodes opérationnelles sont asynchrones pour supporter
 * aussi bien les drivers fichier (SQLite) que les drivers réseau
 * (MySQL, PostgreSQL, etc.).
 */
export interface DatabaseDriver {
    // --- Identité du driver ---

    /** Type du driver. */
    readonly driverType: DatabaseDriverType;

    /** Catégorie du driver (sql / nosql). */
    readonly category: DatabaseCategory;

    /** Informations affichables du driver. */
    readonly info: DriverInfo;

    /** Capacités supportées par ce driver. */
    readonly capabilities: DriverCapabilities;

    // --- Cycle de vie ---

    /** Indique si la connexion est ouverte. */
    readonly isOpen: boolean;

    /** Indique si une transaction est en cours. */
    readonly isInTransaction: boolean;

    /** Chemin ou URI de la connexion. */
    readonly path: string | null;

    /**
     * Fixe les options d'établissement de la prochaine connexion (SSL, délai,
     * URI MongoDB, jeton libSQL, authentification Azure). À appeler avant `open` ;
     * un driver ignore les options qui ne le concernent pas.
     */
    configureConnection(options: DriverConnectionOptions): Promise<void>;

    /**
     * Ouvre une connexion à la base de données.
     * Pour les drivers fichier : `filePath` est le chemin du fichier.
     * Pour les drivers réseau : `filePath` est une URI de connexion.
     * Retourne `true` si un mot de passe est nécessaire.
     */
    open(filePath: string): Promise<boolean>;

    /**
     * Déverrouille une base chiffrée avec le mot de passe fourni.
     * @throws Si le driver ne supporte pas le chiffrement.
     */
    unlock(password: string): Promise<void>;

    /** Ferme la connexion et libère les ressources. */
    close(): Promise<void>;

    // --- Schéma ---

    /** Récupère le schéma complet de la base. */
    getSchema(): Promise<DatabaseSchema>;

    /**
     * Récupère le SQL de création de chaque table.
     * @throws Si le driver ne supporte pas les requêtes SQL.
     */
    getTablesSql(): Promise<{ name: string; sql: string }[]>;

    // --- Données ---

    /**
     * Récupère les données paginées d'une table/collection.
     */
    getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode?: "sql" | "fulltext",
    ): Promise<{ records: DbRecord[]; totalCount: number; tableSize: number }>;

    /** Met à jour une cellule. */
    updateCell(tableName: string, rowid: number, column: string, value: unknown): Promise<void>;

    /** Supprime des lignes par leurs identifiants. */
    deleteRows(tableName: string, rowids: number[]): Promise<void>;

    /** Récupère une ligne par son identifiant. */
    getRow(tableName: string, rowid: number): Promise<DbRecord | null>;

    /** Insère une nouvelle ligne. Retourne l'identifiant de la ligne insérée. */
    insertRow(tableName: string, values: Record<string, unknown>): Promise<number>;

    /** Met à jour le même champ sur plusieurs lignes. */
    batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): Promise<void>;

    /**
     * Supprime toutes les lignes d'une table. Un `DELETE` plutôt qu'un `TRUNCATE` :
     * il reste annulable dans une transaction et existe dans tous les dialectes.
     * @returns Le nombre de lignes supprimées.
     */
    truncateTable(tableName: string): Promise<number>;

    // --- Transactions ---

    /** Démarre une transaction. */
    beginTransaction(): Promise<void>;

    /** Valide la transaction en cours. */
    commit(): Promise<void>;

    /** Annule la transaction en cours. */
    rollback(): Promise<void>;

    // --- Export / Import ---

    /**
     * Exporte les données d'une table.
     */
    exportData(
        tableName: string,
        format: "json" | "csv" | "xlsx",
        rowids?: number[],
        filter?: string,
    ): Promise<{ data: string; filename: string }>;

    /**
     * Importe des données dans une table.
     */
    importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): Promise<void>;

    /**
     * Parse et retourne un aperçu des données importées.
     */
    previewImport(
        tableName: string,
        format: "csv" | "json",
        data: string,
    ): Promise<{ preview: DbRecord[]; totalRows: number; errors: string[] }>;

    // --- SQL (uniquement pour les drivers SQL) ---

    /**
     * Exécute une requête SQL arbitraire.
     * @param maxRows - Plafond de lignes lues. Un driver capable de lire en flux
     * s'arrête là et signale `truncated` ; les autres l'ignorent, et l'hôte des
     * drivers tronque le résultat après coup.
     * @throws Si le driver ne supporte pas les requêtes SQL.
     */
    execSql(sql: string, maxRows?: number): Promise<R_SqlExecResponse>;

    // --- Index (si supporté) ---

    /** Récupère les index d'une table. */
    getIndexes(tableName: string): Promise<IndexDef[]>;

    /** Crée un index sur une table. */
    createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void>;

    /** Supprime un index. */
    dropIndex(indexName: string): Promise<void>;

    // --- Schéma (si supporté) ---

    /** Crée une nouvelle table. */
    createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): Promise<void>;

    /** Modifie le schéma d'une table. */
    alterTable(action: R_AlterTableAction): Promise<void>;

    /** Supprime une table. */
    dropTable(tableName: string): Promise<void>;

    // --- Chiffrement (si supporté) ---

    /**
     * Change ou supprime le mot de passe de la base.
     * @throws Si le driver ne supporte pas le chiffrement.
     */
    changePassword(newPassword: string | null): Promise<void>;
}
