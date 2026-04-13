export type AppState = {
    connected: boolean;
    database: DatabaseSchema | null;
    filePath: string | null;
};

export type DatabaseSchema = {
    name: string;
    path: string;
    tables: TableSchema[];
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
};

export type R_TableDataResponse = {
    records: DbRecord[];
    totalCount: number;
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
    format: "json" | "csv";
    rowids?: number[];
    filter?: string;
};

export type R_ExportResponse = {
    data: string;
    filename: string;
};

