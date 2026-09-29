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

export type { DatabaseDriver } from "src/core/drivers/driver.interface";
export { SqliteDialectDriver } from "src/core/drivers/sqlite-dialect.driver";
export { SqliteDriver } from "src/core/drivers/sqlite.driver";
export { LibsqlDriver } from "src/core/drivers/libsql.driver";
export { NetworkSqlDriver } from "src/core/drivers/network-sql.driver";
export { MysqlDriver } from "src/core/drivers/mysql.driver";
export { PostgresqlDriver } from "src/core/drivers/postgresql.driver";
export { OracleDriver } from "src/core/drivers/oracle.driver";
export { MssqlDriver } from "src/core/drivers/mssql.driver";
export { AzureSqlDriver } from "src/core/drivers/azure-sql.driver";
export { MongodbDriver } from "src/core/drivers/mongodb.driver";
export { createDriver } from "src/core/drivers/driver-factory";
export { getDriverInfo, getDriverCategory, getAllDriverInfos } from "src/core/drivers/driver-registry";
