export type AppState = {
    tabs: Map<number, AppTabState>;
    currentTabId: number;
};

export type AppTabState = {
    isConnected: boolean;
    database?: DatabaseSchema;
};

export type DatabaseSchema = {
    name: string;
    path: string;
    tables: TableSchema[];
};

export type TableSchema = {
    name: string;
    fields: FieldDef[];
    weight: number; // poids de la table en octets
    recordCount: number; // nombre d'enregistrements
};

// Reprend les informations importantes d'un schéma de table sqlite
export type FieldDef = {
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: string | null;
    pk: boolean;
};

export type Record = {
    [columnName: string]: any;
};

// ---

// Le body de la requête depuis le renderer vers le main pour une connexion à une BDD
export type R_ConnBody = {

};

export type R_ConnResponse = {
    needsPassword: boolean;
};

export type R_ConnPasswordBody = {
    password: string;
};

export type R_ConnPasswordResponse = {};

