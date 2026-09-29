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

import { safeStorage } from "electron/main";
import type { SystemKeychain } from "src/core/services/system-keychain.types";

/**
 * Trousseau du système via `safeStorage` d'Electron. N'est utilisable qu'après
 * l'événement `ready` de l'application.
 */
export const electronKeychain: SystemKeychain = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: plaintext => safeStorage.encryptString(plaintext),
    decrypt: ciphertext => safeStorage.decryptString(ciphertext),
};
