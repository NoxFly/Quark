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


import { exposeNoxusBridge } from "@noxfly/noxus/preload";
import type { PreloadApi } from "@shared/ipc-renderer";
import { contextBridge, webUtils } from "electron/renderer";

// Toute la communication avec le main passe par Noxus : le preload n'expose que
// la poignée de main de son MessagePort, et ce que seul un preload peut faire.
exposeNoxusBridge();

const api: PreloadApi = {
    // Le chemin d'un fichier déposé n'est accessible qu'au preload depuis que
    // `File.path` a disparu, y compris dans un renderer sandboxé.
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("quark", api);
