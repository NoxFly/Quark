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
import type { DriverPresentation } from "src/app/core/models/driver-presentation.model";

/** Logo de chaque driver (`null` : monogramme). SQLite et libSQL n'ont pas de logo. */
export const DRIVER_LOGOS: Record<DatabaseDriverType, string | null> = {
    sqlite: null,
    libsql: null,
    mysql: "images/logo-mysql-mariadb.png",
    postgresql: "images/logo-postgresql.png",
    oracle: "images/logo-oracle.png",
    mssql: "images/logo-mssql.png",
    azure: "images/logo-azure.png",
    mongodb: "images/logo-mongodb.png",
};

/** Monogramme de chaque driver, affiché à défaut de logo. */
export const DRIVER_MONOGRAMS: Record<DatabaseDriverType, string> = {
    sqlite: "SQ",
    libsql: "SQ",
    mysql: "My",
    postgresql: "Pg",
    oracle: "Or",
    mssql: "MS",
    azure: "Az",
    mongodb: "Mg",
};

/**
 * Types de base proposés sur la page d'accueil, dans l'ordre de la maquette.
 * `libsql` n'y figure pas : c'est le mode « URL distante » de la carte SQLite.
 */
export const HOME_DRIVERS: readonly DriverPresentation[] = [
    {
        type: "sqlite",
        label: "SQLite",
        monogram: DRIVER_MONOGRAMS.sqlite,
        logo: DRIVER_LOGOS.sqlite,
        tint: "var(--tint-sqlite)",
        descriptionKey: "home.driver.sqlite.description",
        hintKey: "home.driver.sqlite.hint",
        defaultPort: null,
        form: "file",
    },
    {
        type: "mysql",
        label: "MariaDB / MySQL",
        monogram: DRIVER_MONOGRAMS.mysql,
        logo: DRIVER_LOGOS.mysql,
        tint: "var(--tint-mysql)",
        descriptionKey: "home.driver.mysql.description",
        hintKey: "home.driver.mysql.hint",
        defaultPort: 3306,
        form: "server",
    },
    {
        type: "oracle",
        label: "Oracle",
        monogram: DRIVER_MONOGRAMS.oracle,
        logo: DRIVER_LOGOS.oracle,
        tint: "var(--tint-oracle)",
        descriptionKey: "home.driver.oracle.description",
        hintKey: "home.driver.oracle.hint",
        defaultPort: 1521,
        form: "server",
    },
    {
        type: "postgresql",
        label: "PostgreSQL",
        monogram: DRIVER_MONOGRAMS.postgresql,
        logo: DRIVER_LOGOS.postgresql,
        tint: "var(--tint-postgresql)",
        descriptionKey: "home.driver.postgresql.description",
        hintKey: "home.driver.postgresql.hint",
        defaultPort: 5432,
        form: "server",
    },
    {
        type: "mssql",
        label: "SQL Server",
        monogram: DRIVER_MONOGRAMS.mssql,
        logo: DRIVER_LOGOS.mssql,
        tint: "var(--tint-mssql)",
        descriptionKey: "home.driver.mssql.description",
        hintKey: "home.driver.mssql.hint",
        defaultPort: 1433,
        form: "server",
    },
    {
        type: "azure",
        label: "Azure SQL",
        monogram: DRIVER_MONOGRAMS.azure,
        logo: DRIVER_LOGOS.azure,
        tint: "var(--tint-azure)",
        descriptionKey: "home.driver.azure.description",
        hintKey: "home.driver.azure.hint",
        defaultPort: 1433,
        form: "server",
    },
    {
        type: "mongodb",
        label: "MongoDB",
        monogram: DRIVER_MONOGRAMS.mongodb,
        logo: DRIVER_LOGOS.mongodb,
        tint: "var(--tint-mongodb)",
        descriptionKey: "home.driver.mongodb.description",
        hintKey: "home.driver.mongodb.hint",
        defaultPort: 27017,
        form: "uri",
    },
];
