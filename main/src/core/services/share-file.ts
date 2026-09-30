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
import { decryptFromXml, encryptToXml } from "src/core/services/connection-crypto";
import type { DriverConnectionTarget } from "src/core/drivers/connection-target.types";

/** Extension des fichiers de partage (sans point). */
export const SHARE_FILE_EXTENSION = "quarkshare";

/** Longueur minimale d'un mot de passe de partage. */
export const MIN_SHARE_PASSWORD_LENGTH = 3;

const SHARE_PAYLOAD_FORMAT = "quark-share";
const SHARE_PAYLOAD_VERSION = 1;

/**
 * Contenu déchiffré d'un fichier de partage. Tout y est chiffré, restrictions
 * comprises : modifier le fichier le rend illisible (AES-GCM authentifie le
 * contenu), si bien qu'une échéance ou un mode lecture seule ne s'en retirent pas.
 */
export interface SharePayload {
    /** Identifiant du partage, pour l'usage unique. */
    id: string;
    name: string;
    readOnly: boolean;
    singleUse: boolean;
    /** Horodatage de création, en millisecondes. */
    createdAt: number;
    /** Échéance, en millisecondes ; absente : sans limite. */
    expiresAt?: number;
    /** De quoi se connecter, secret compris. */
    target: DriverConnectionTarget;
}

/** Le mot de passe de partage ne déchiffre pas le fichier. */
export class ShareWrongPasswordError extends Error {
    public constructor() {
        super("Wrong share password");
    }
}

/** Le fichier n'est pas un fichier de partage lisible. */
export class ShareInvalidFileError extends Error {
    public constructor(reason: string) {
        super(`Invalid share file: ${reason}`);
    }
}

/**
 * Chiffre un partage par son mot de passe.
 * @returns Le contenu du fichier `.quarkshare`.
 * @throws Si le mot de passe est trop court.
 */
export async function encryptShare(payload: SharePayload, password: string): Promise<string> {
    if (password.length < MIN_SHARE_PASSWORD_LENGTH) {
        throw new Error(`The share password must be at least ${MIN_SHARE_PASSWORD_LENGTH} characters long`);
    }

    const document = { format: SHARE_PAYLOAD_FORMAT, version: SHARE_PAYLOAD_VERSION, ...payload };
    return await encryptToXml(JSON.stringify(document), password);
}

/**
 * Déchiffre et valide un fichier de partage.
 * @throws ShareWrongPasswordError si le mot de passe ne convient pas.
 * @throws ShareInvalidFileError si le fichier n'est pas un partage valide.
 */
export async function decryptShare(content: string, password: string): Promise<SharePayload> {
    let plaintext: string;

    try {
        plaintext = await decryptFromXml(content, password);
    }
    catch (error) {
        // Une enveloppe illisible n'est pas une erreur de mot de passe.
        if (error instanceof Error && error.message === "Invalid vault envelope") {
            throw new ShareInvalidFileError("not an encrypted Quark file");
        }

        throw new ShareWrongPasswordError();
    }

    return parsePayload(plaintext);
}

function parsePayload(plaintext: string): SharePayload {
    let document: Record<string, unknown>;

    try {
        document = JSON.parse(plaintext) as Record<string, unknown>;
    }
    catch {
        throw new ShareInvalidFileError("unreadable content");
    }

    if (document["format"] !== SHARE_PAYLOAD_FORMAT) {
        throw new ShareInvalidFileError("not a share file");
    }

    if (typeof document["version"] !== "number" || document["version"] > SHARE_PAYLOAD_VERSION) {
        throw new ShareInvalidFileError("created by a newer version of Quark");
    }

    const target = document["target"] as Partial<DriverConnectionTarget> | undefined;

    if (
        typeof document["id"] !== "string"
        || typeof document["name"] !== "string"
        || typeof target?.driverType !== "string"
        || typeof target.location !== "string"
    ) {
        throw new ShareInvalidFileError("incomplete content");
    }

    const expiresAt = document["expiresAt"];

    return {
        id: document["id"],
        name: document["name"],
        readOnly: document["readOnly"] !== false,
        singleUse: document["singleUse"] === true,
        createdAt: Number(document["createdAt"]) || 0,
        expiresAt: typeof expiresAt === "number" ? expiresAt : undefined,
        target: {
            driverType: target.driverType as DatabaseDriverType,
            location: target.location,
            options: target.options ?? {},
        },
    };
}
