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

/**
 * Chiffrement lié à la session de l'utilisateur du système (DPAPI sous Windows,
 * trousseau sous macOS, libsecret / kwallet sous Linux).
 *
 * Abstraction de `safeStorage` : les services qui en dépendent se testent avec
 * une implémentation factice, sans Electron.
 */
export interface SystemKeychain {
    /** Le chiffrement du système est utilisable (faux notamment sur un Linux sans trousseau). */
    isAvailable(): boolean;
    /** Chiffre un texte ; le résultat n'est déchiffrable que par ce même compte système. */
    encrypt(plaintext: string): Buffer;
    /** Déchiffre ce que `encrypt` a produit. Lève si le contenu n'est pas déchiffrable. */
    decrypt(ciphertext: Buffer): string;
}
