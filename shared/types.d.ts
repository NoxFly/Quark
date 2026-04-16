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
};

export type R_PasswordBody = {
    password: string;
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
    filterMode?: "sqlite" | "fulltext";
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
    rows: unknown[][];
    rowsAffected: number;
    lastInsertId?: number;
    isSelect: boolean;
    executionTimeMs: number;
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

