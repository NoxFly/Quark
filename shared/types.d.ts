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

import type { DatabaseDriverType, DriverInfo } from "./driver";

export type AppState = {
    connected: boolean;
    database: DatabaseSchema | null;
    filePath: string | null;
    driverType: DatabaseDriverType | null;
    driverInfo: DriverInfo | null;
};

export type DatabaseSchema = {
    name: string;
    path: string;
    tables: TableSchema[];
    driverType: DatabaseDriverType;
};

export type TableSchema = {
    name: string;
    fields: FieldDef[];
    weight: number;
    recordCount: number;
};

/**
 * Reprend les informations importantes d'un schéma de table sqlite.
 */
export type FieldDef = {
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: string | null;
    pk: boolean;
    fk: ForeignKeyDef | null;
};

/**
 * Décrit une clé étrangère sur un champ.
 */
export type ForeignKeyDef = {
    table: string;
    column: string;
};

export type DbRecord = {
    [columnName: string]: unknown;
};

// --- Request / Response DTOs ---

export type R_OpenFileBody = {
    filePath: string;
};

export type R_OpenFileResponse = {
    needsPassword: boolean;
    database: DatabaseSchema | null;
    /** Le fichier était déjà ouvert dans une autre fenêtre, qui a été remontée. */
    alreadyOpen?: boolean;
};

/**
 * Réponse minimale après établissement d'une connexion réseau (sans schéma).
 * Le schéma est chargé séparément via `getSchema()`.
 */
export type R_ConnectNetworkResponse = {
    connected: boolean;
};

export type R_PasswordBody = {
    password: string;
    /**
     * Mémoriser le mot de passe dans le trousseau du système (`safeStorage`,
     * « trousseau Windows ») pour ouvrir ce fichier sans saisie la prochaine fois.
     */
    remember?: boolean;
};

export type R_PasswordResponse = {
    database: DatabaseSchema;
};

export type R_CloseFileResponse = {
    closed: boolean;
};

export type R_TableDataBody = {
    table: string;
    offset: number;
    limit: number;
    orderBy?: string;
    orderDir?: "ASC" | "DESC";
    filter?: string;
    filterMode?: "sql" | "fulltext";
};

export type R_TableDataResponse = {
    records: DbRecord[];
    totalCount: number;
    tableSize: number;
};

export type R_UpdateCellBody = {
    table: string;
    rowid: number;
    column: string;
    value: unknown;
};

export type R_DeleteRowsBody = {
    table: string;
    rowids: number[];
};

export type R_TransactionAction = "begin" | "commit" | "rollback";

export type R_ExportBody = {
    table: string;
    format: "json" | "csv" | "xlsx";
    rowids?: number[];
    filter?: string;
};

export type R_ExportResponse = {
    data: string;
    filename: string;
};

export type R_InsertRowBody = {
    table: string;
    values: Record<string, unknown>;
};

export type R_InsertRowResponse = {
    rowid: number;
    record: DbRecord;
};

export type R_GetRowBody = {
    table: string;
    rowid: number;
};

export type R_GetRowResponse = {
    record: DbRecord | null;
};

export type R_WindowStateResponse = {
    inTransaction: boolean;
    selectedTable: string | null;
    database: DatabaseSchema | null;
    filePath: string | null;
    driverType: DatabaseDriverType | null;
    driverInfo: DriverInfo | null;
};

// --- Mutation history (undo/redo) ---

export type MutationType = "update" | "insert" | "delete";

export type MutationRecord = {
    id: number;
    type: MutationType;
    table: string;
    rowid: number;
    column?: string;
    oldValue?: unknown;
    newValue?: unknown;
    oldRecord?: DbRecord;
};

// --- SQL Editor ---

export type R_SqlExecBody = {
    sql: string;
};

export type R_SqlExecResponse = {
    columns: string[];
    /**
     * Lignes du résultat. Via l'IPC, seule la première page est transmise : les
     * suivantes se lisent par `R_SqlRowsBody` tant que `resultId` est valide.
     */
    rows: unknown[][];
    rowsAffected: number;
    lastInsertId?: number;
    isSelect: boolean;
    executionTimeMs: number;
    /** Nombre total de lignes conservées côté hôte (au plus le plafond de résultat). */
    totalRows?: number;
    /** Identifiant du résultat conservé par l'hôte des drivers, `null` s'il tient dans la première page. */
    resultId?: string | null;
    /** Le résultat a été tronqué au plafond de lignes conservées. */
    truncated?: boolean;
};

export type R_SqlRowsBody = {
    resultId: string;
    offset: number;
    limit: number;
};

export type R_SqlRowsResponse = {
    rows: unknown[][];
};

// --- Import ---

export type R_ImportDataBody = {
    table: string;
    format: "csv" | "json";
    data: string;
    mode: "insert" | "upsert";
};

export type R_ImportPreviewResponse = {
    preview: DbRecord[];
    totalRows: number;
    errors: string[];
};

// --- Indexes ---

export type IndexDef = {
    name: string;
    table: string;
    unique: boolean;
    columns: string[];
    origin: string;
};

export type R_GetIndexesResponse = {
    indexes: IndexDef[];
};

export type R_CreateIndexBody = {
    table: string;
    name: string;
    columns: string[];
    unique: boolean;
};

// --- Schema operations ---

export type CreateTableColumnDef = {
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    primaryKey: boolean;
    unique: boolean;
};

export type R_CreateTableBody = {
    name: string;
    columns: CreateTableColumnDef[];
    ifNotExists: boolean;
};

export type R_AlterTableAction =
    | { action: "rename-table"; table: string; newName: string }
    | { action: "add-column"; table: string; column: CreateTableColumnDef }
    | { action: "rename-column"; table: string; column: string; newName: string }
    | { action: "drop-column"; table: string; column: string };

// --- Password / encryption ---

export type R_ChangePasswordBody = {
    newPassword: string | null;
};

// --- Batch update ---

export type R_BatchUpdateBody = {
    table: string;
    rowids: number[];
    column: string;
    value: unknown;
};

// --- Network connection ---

export type R_NetworkConnectBody = {
    driverType: import("./driver").DatabaseDriverType;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    /** Mode d'authentification Azure (défaut `sql`). */
    authMode?: import("./connection").AzureAuthMode;
    /** Client ID Azure AD (requis pour `service-principal`). */
    clientId?: string;
    /** Tenant ID Azure AD (requis pour `service-principal`). */
    tenantId?: string;
    /** URI de connexion complète (MongoDB) ; prioritaire sur hôte / port / identifiants. */
    uri?: string;
    /** Chiffrer la connexion (SSL / TLS). Défaut : comportement historique du driver. */
    ssl?: boolean;
    /** Délai avant abandon de l'établissement de la connexion, en secondes. */
    timeoutSeconds?: number;
};

/**
 * Ouverture d'une base SQLite distante (libSQL / Turso : `libsql://`, `https://`, `wss://`).
 */
export type R_RemoteSqliteBody = {
    url: string;
    /** Jeton d'authentification (optionnel selon le serveur). */
    authToken?: string;
    timeoutSeconds?: number;
};

/**
 * Cible d'un test de connexion : une connexion réseau, une base SQLite distante
 * ou un fichier SQLite local (dont on vérifie seulement l'existence et la lisibilité).
 *
 * `profileId` (optionnel) : profil du coffre en cours d'édition. Son secret étant
 * write-only, le formulaire ne peut pas le renvoyer ; un mot de passe (ou jeton)
 * vide est alors complété côté main par celui du profil, si le coffre est déverrouillé.
 */
export type R_TestConnectionBody =
    | ({ kind: "network"; profileId?: string } & R_NetworkConnectBody)
    | ({ kind: "remote-sqlite"; profileId?: string } & R_RemoteSqliteBody)
    | { kind: "file"; filePath: string };

// --- Stored Procedures (MSSQL) ---

/**
 * Paramètre d'une procédure stockée.
 */
export type StoredProcedureParam = {
    name: string;
    type: string;
    maxLength: number | null;
    isOutput: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
};

/**
 * Définition d'une procédure stockée (résumé pour la liste).
 */
export type StoredProcedureDef = {
    name: string;
    schema: string;
};

/**
 * Définition complète d'une procédure stockée (détail).
 */
export type StoredProcedureDetail = {
    name: string;
    schema: string;
    definition: string;
    params: StoredProcedureParam[];
    createdAt: string | null;
    modifiedAt: string | null;
};

/**
 * Résultat de l'exécution d'une procédure stockée.
 */
export type StoredProcedureExecResult = {
    columns: string[];
    rows: unknown[][];
    rowsAffected: number;
    outputParams: Record<string, unknown>;
    executionTimeMs: number;
};

export type R_StoredProcListResponse = {
    procedures: StoredProcedureDef[];
};

export type R_StoredProcDetailBody = {
    name: string;
    schema: string;
};

export type R_StoredProcExecBody = {
    name: string;
    schema: string;
    params: Record<string, unknown>;
};

export type R_StoredProcModifyBody = {
    name: string;
    schema: string;
    definition: string;
};

export type R_StoredProcDropBody = {
    name: string;
    schema: string;
};

