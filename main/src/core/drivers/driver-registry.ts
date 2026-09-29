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

import type { DatabaseCategory, DatabaseDriverType, DriverInfo } from "@shared/driver";

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
