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

import type { DatabaseDriverType } from "@shared/driver";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";

/**
 * Instancie le bon driver à partir de son type.
 *
 * Réservé au process hôte des drivers. Chaque driver n'est chargé qu'à sa
 * première utilisation : importer tous les clients de bases d'un coup lisait
 * plus de 800 fichiers au démarrage de l'hôte — jusqu'à plusieurs dizaines de
 * secondes à froid (cache disque vide, antivirus), pendant lesquelles la
 * première ouverture d'une base restait sans réponse.
 */
export async function createDriver(type: DatabaseDriverType): Promise<DatabaseDriver> {
    switch (type) {
        case "sqlite":
            return new (await import("src/core/drivers/sqlite.driver")).SqliteDriver();
        case "libsql":
            return new (await import("src/core/drivers/libsql.driver")).LibsqlDriver();
        case "mysql":
            return new (await import("src/core/drivers/mysql.driver")).MysqlDriver();
        case "postgresql":
            return new (await import("src/core/drivers/postgresql.driver")).PostgresqlDriver();
        case "oracle":
            return new (await import("src/core/drivers/oracle.driver")).OracleDriver();
        case "mssql":
            return new (await import("src/core/drivers/mssql.driver")).MssqlDriver();
        case "azure":
            return new (await import("src/core/drivers/azure-sql.driver")).AzureSqlDriver();
        case "mongodb":
            return new (await import("src/core/drivers/mongodb.driver")).MongodbDriver();
        default:
            throw new Error(`Unknown driver type: "${type}"`);
    }
}
