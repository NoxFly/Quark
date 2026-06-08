/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

/**
 * Types de bases de données supportés.
 * Chaque valeur correspond à un driver spécifique.
 */
export type DatabaseDriverType =
    | "sqlite"
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
