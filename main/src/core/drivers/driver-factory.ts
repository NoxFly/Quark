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
import { AzureSqlDriver } from "src/core/drivers/azure-sql.driver";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { MongodbDriver } from "src/core/drivers/mongodb.driver";
import { MssqlDriver } from "src/core/drivers/mssql.driver";
import { MysqlDriver } from "src/core/drivers/mysql.driver";
import { OracleDriver } from "src/core/drivers/oracle.driver";
import { PostgresqlDriver } from "src/core/drivers/postgresql.driver";
import { SqliteDriver } from "src/core/drivers/sqlite.driver";

/**
 * Instancie le bon driver à partir de son type.
 *
 * Réservé au process hôte des drivers : importer ce module embarque tous les
 * clients de bases de données (et le module natif SQLite).
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
