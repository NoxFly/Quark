/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    IndexDef,
    R_AlterTableAction,
    R_SqlExecResponse,
} from "@shared/types";
import type { DriverCapabilities, DriverInfo, DatabaseDriverType, DatabaseCategory } from "@shared/driver";

/**
 * Contrat abstrait que tout driver de base de données doit implémenter.
 * Définit les opérations fondamentales communes à tous les types de bases.
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
     * Ouvre une connexion à la base de données.
     * Pour les drivers fichier : `filePath` est le chemin du fichier.
     * Retourne `true` si un mot de passe est nécessaire.
     */
    open(filePath: string): boolean;

    /**
     * Déverrouille une base chiffrée avec le mot de passe fourni.
     * @throws Si le driver ne supporte pas le chiffrement.
     */
    unlock(password: string): void;

    /** Ferme la connexion et libère les ressources. */
    close(): void;

    // --- Schéma ---

    /** Récupère le schéma complet de la base. */
    getSchema(): DatabaseSchema;

    /**
     * Récupère le SQL de création de chaque table.
     * @throws Si le driver ne supporte pas les requêtes SQL.
     */
    getTablesSql(): { name: string; sql: string }[];

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
        filterMode?: "sqlite" | "fulltext",
    ): { records: DbRecord[]; totalCount: number; tableSize: number };

    /** Met à jour une cellule. */
    updateCell(tableName: string, rowid: number, column: string, value: unknown): void;

    /** Supprime des lignes par leurs identifiants. */
    deleteRows(tableName: string, rowids: number[]): void;

    /** Récupère une ligne par son identifiant. */
    getRow(tableName: string, rowid: number): DbRecord | null;

    /** Insère une nouvelle ligne. Retourne l'identifiant de la ligne insérée. */
    insertRow(tableName: string, values: Record<string, unknown>): number;

    /** Met à jour le même champ sur plusieurs lignes. */
    batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): void;

    // --- Transactions ---

    /** Démarre une transaction. */
    beginTransaction(): void;

    /** Valide la transaction en cours. */
    commit(): void;

    /** Annule la transaction en cours. */
    rollback(): void;

    // --- Export / Import ---

    /**
     * Exporte les données d'une table.
     */
    exportData(
        tableName: string,
        format: "json" | "csv" | "xlsx",
        rowids?: number[],
        filter?: string,
    ): { data: string; filename: string };

    /**
     * Importe des données dans une table.
     */
    importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): void;

    /**
     * Parse et retourne un aperçu des données importées.
     */
    previewImport(
        tableName: string,
        format: "csv" | "json",
        data: string,
    ): { preview: DbRecord[]; totalRows: number; errors: string[] };

    // --- SQL (uniquement pour les drivers SQL) ---

    /**
     * Exécute une requête SQL arbitraire.
     * @throws Si le driver ne supporte pas les requêtes SQL.
     */
    execSql(sql: string): R_SqlExecResponse;

    // --- Index (si supporté) ---

    /** Récupère les index d'une table. */
    getIndexes(tableName: string): IndexDef[];

    /** Crée un index sur une table. */
    createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): void;

    /** Supprime un index. */
    dropIndex(indexName: string): void;

    // --- Schéma (si supporté) ---

    /** Crée une nouvelle table. */
    createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): void;

    /** Modifie le schéma d'une table. */
    alterTable(action: R_AlterTableAction): void;

    /** Supprime une table. */
    dropTable(tableName: string): void;

    // --- Chiffrement (si supporté) ---

    /**
     * Change ou supprime le mot de passe de la base.
     * @throws Si le driver ne supporte pas le chiffrement.
     */
    changePassword(newPassword: string | null): void;
}
