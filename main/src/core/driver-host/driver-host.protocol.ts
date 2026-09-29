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

/**
 * État synchrone du driver, recopié côté main après chaque appel.
 *
 * `DatabaseDriver` expose ces valeurs en lecture synchrone (`isOpen`, `path`…) :
 * le proxy ne peut pas les demander à l'hôte à chaque lecture, il garde donc la
 * dernière image renvoyée avec chaque réponse.
 */
export interface DriverHostState {
    isOpen: boolean;
    isInTransaction: boolean;
    path: string | null;
}

/** Première page d'un résultat SQL renvoyée au renderer. */
export const SQL_FIRST_PAGE_SIZE = 500;

/**
 * Nombre maximal de lignes conservées pour un résultat SQL.
 *
 * Au-delà, le résultat est tronqué et signalé comme tel : afficher un million de
 * lignes n'a pas de sens dans une grille, et les garder saturerait l'hôte.
 */
export const SQL_MAX_RESULT_ROWS = 200_000;

export interface DriverHostInitRequest {
    id: number;
    kind: "init";
    driverType: DatabaseDriverType;
}

export interface DriverHostCallRequest {
    id: number;
    kind: "call";
    method: string;
    args: unknown[];
}

export type DriverHostRequest = DriverHostInitRequest | DriverHostCallRequest;

export interface DriverHostSuccess {
    id: number;
    ok: true;
    result: unknown;
    state: DriverHostState;
}

export interface DriverHostFailure {
    id: number;
    ok: false;
    error: string;
    state: DriverHostState;
}

export type DriverHostResponse = DriverHostSuccess | DriverHostFailure;

/** Argument de ligne de commande portant le fichier de log de l'hôte. */
export const DRIVER_HOST_LOG_ARG = "--log-file=";
