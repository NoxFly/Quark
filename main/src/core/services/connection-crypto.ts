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

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * Chiffrement symétrique d'un contenu texte dans une enveloppe XML.
 *
 * Utilisé à la fois pour le coffre local (clé dérivée du mot de passe maître)
 * et pour les fichiers d'export partageables (clé dérivée d'une passphrase).
 * Aucune dépendance externe au chiffrement : `node:crypto` (AES-256-GCM + scrypt).
 */

const CIPHER = "aes-256-gcm";
const KDF = "scrypt";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ENVELOPE_ROOT = "noxEditorVault";

// `parseTagValue: false` empêche la conversion d'un base64 entièrement numérique
// en nombre (ce qui corromprait les données chiffrées).
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/**
 * Dérive une clé AES-256 de 32 octets à partir d'une passphrase et d'un sel.
 *
 * scrypt est volontairement coûteux (plusieurs dizaines de millisecondes) : sa
 * version asynchrone tourne dans le pool de libuv au lieu de geler le thread
 * principal, et avec lui toutes les fenêtres, à chaque sauvegarde du coffre.
 */
async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
    return await scryptAsync(passphrase, salt, KEY_LENGTH);
}

/**
 * Chiffre un texte clair et retourne une enveloppe XML auto-décrivante.
 * @param plaintext - Contenu à chiffrer (lui-même du XML décrivant les profils).
 * @param passphrase - Secret de dérivation de la clé.
 * @returns Document XML contenant sel, IV, tag d'authentification et données chiffrées (base64).
 */
export async function encryptToXml(plaintext: string, passphrase: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await deriveKey(passphrase, salt);

    const cipher = createCipheriv(CIPHER, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope = {
        [ENVELOPE_ROOT]: {
            "@_version": "1",
            "@_cipher": CIPHER,
            "@_kdf": KDF,
            salt: salt.toString("base64"),
            iv: iv.toString("base64"),
            tag: tag.toString("base64"),
            data: ciphertext.toString("base64"),
        },
    };

    return xmlBuilder.build(envelope);
}

/**
 * Déchiffre une enveloppe XML produite par `encryptToXml`.
 * @throws Si la passphrase est incorrecte (échec de vérification du tag GCM)
 *         ou si l'enveloppe est malformée.
 */
export async function decryptFromXml(xml: string, passphrase: string): Promise<string> {
    const parsed = xmlParser.parse(xml) as Record<string, unknown>;
    const envelope = parsed[ENVELOPE_ROOT] as Record<string, string> | undefined;

    if (!envelope?.["salt"] || !envelope["iv"] || !envelope["tag"] || envelope["data"] === undefined) {
        throw new Error("Invalid vault envelope");
    }

    const salt = Buffer.from(envelope["salt"], "base64");
    const iv = Buffer.from(envelope["iv"], "base64");
    const tag = Buffer.from(envelope["tag"], "base64");
    const ciphertext = Buffer.from(String(envelope["data"]), "base64");
    const key = await deriveKey(passphrase, salt);

    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(tag);

    // `final()` lève si le tag ne correspond pas → mot de passe / passphrase erroné.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf-8");
}
