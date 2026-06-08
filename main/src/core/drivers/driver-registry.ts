/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import type { DatabaseCategory, DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { AzureSqlDriver } from "src/core/drivers/azure-sql.driver";
import { MongodbDriver } from "src/core/drivers/mongodb.driver";
import { MssqlDriver } from "src/core/drivers/mssql.driver";
import { MysqlDriver } from "src/core/drivers/mysql.driver";
import { OracleDriver } from "src/core/drivers/oracle.driver";
import { PostgresqlDriver } from "src/core/drivers/postgresql.driver";
import { SqliteDriver } from "src/core/drivers/sqlite.driver";

/**
 * Map des catégories par type de driver.
 */
const DRIVER_CATEGORIES: Record<DatabaseDriverType, DatabaseCategory> = {
    sqlite: "sql",
    mysql: "sql",
    postgresql: "sql",
    oracle: "sql",
    mssql: "sql",
    azure: "sql",
    mongodb: "nosql",
};

/**
 * Métadonnées de chaque driver, exposables au renderer.
 */
const DRIVER_INFOS: Record<DatabaseDriverType, DriverInfo> = {
    sqlite: {
        type: "sqlite",
        category: "sql",
        displayName: "SQLite",
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: true,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: false,
            storedProcedures: false,
        },
    },
    mysql: {
        type: "mysql",
        category: "sql",
        displayName: "MySQL / MariaDB",
        defaultPort: 3306,
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: true,
            storedProcedures: false,
        },
    },
    postgresql: {
        type: "postgresql",
        category: "sql",
        displayName: "PostgreSQL",
        defaultPort: 5432,
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: true,
            storedProcedures: false,
        },
    },
    oracle: {
        type: "oracle",
        category: "sql",
        displayName: "Oracle",
        defaultPort: 1521,
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: true,
            storedProcedures: false,
        },
    },
    mssql: {
        type: "mssql",
        category: "sql",
        displayName: "SQL Server",
        defaultPort: 1433,
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: true,
            storedProcedures: true,
        },
    },
    azure: {
        type: "azure",
        category: "sql",
        displayName: "Azure SQL",
        defaultPort: 1433,
        capabilities: {
            transactions: true,
            schemaEditing: true,
            sqlQueries: true,
            foreignKeys: true,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: true,
            collections: false,
            networkConnection: true,
            storedProcedures: true,
        },
    },
    mongodb: {
        type: "mongodb",
        category: "nosql",
        displayName: "MongoDB",
        defaultPort: 27017,
        capabilities: {
            transactions: true,
            schemaEditing: false,
            sqlQueries: false,
            foreignKeys: false,
            encryption: false,
            indexes: true,
            importExport: true,
            erDiagram: false,
            collections: true,
            networkConnection: true,
            storedProcedures: false,
        },
    },
};

/**
 * Registre des drivers disponibles.
 * Instancie le bon driver à partir de son type.
 */
export function createDriver(type: DatabaseDriverType): DatabaseDriver {
    switch (type) {
        case "sqlite":
            return new SqliteDriver();
        case "mysql":
            return new MysqlDriver();
        case "postgresql":
            return new PostgresqlDriver();
        case "oracle":
            return new OracleDriver();
        case "mssql":
            return new MssqlDriver();
        case "azure":
            return new AzureSqlDriver();
        case "mongodb":
            return new MongodbDriver();
        default:
            throw new Error(`Unknown driver type: "${type}"`);
    }
}

/**
 * Retourne les informations d'un driver par son type.
 */
export function getDriverInfo(type: DatabaseDriverType): DriverInfo {
    return DRIVER_INFOS[type];
}

/**
 * Retourne la catégorie d'un driver par son type.
 */
export function getDriverCategory(type: DatabaseDriverType): DatabaseCategory {
    return DRIVER_CATEGORIES[type];
}

/**
 * Retourne la liste de tous les drivers disponibles avec leurs métadonnées.
 */
export function getAllDriverInfos(): DriverInfo[] {
    return Object.values(DRIVER_INFOS);
}
