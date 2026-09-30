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

import { inject, Injectable, Logger, NotFoundException } from "@noxfly/noxus/main";
import type { R_ShareCreateBody, R_ShareOpenResponse, ShareExpiryHours } from "@shared/share";
import { BrowserWindow, dialog } from "electron/main";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { describeConnectionError } from "src/core/drivers/connection-target.helper";
import type { DriverConnectionTarget } from "src/core/drivers/connection-target.types";
import { ConsumedShares } from "src/core/services/consumed-shares";
import { fetchOnlineTime, OnlineClockUnavailableError } from "src/core/services/online-clock";
import {
    decryptShare,
    encryptShare,
    SHARE_FILE_EXTENSION,
    ShareInvalidFileError,
    type SharePayload,
    ShareWrongPasswordError,
} from "src/core/services/share-file";
import type { ShareSession, Window } from "src/core/services/window";
import { Application } from "src/modules/application";
import { ConnectionsService } from "src/modules/connections/connections.service";
import { connectionSecrets, shareTarget } from "src/modules/share/share-target.helper";

const EXPIRY_HOURS: readonly ShareExpiryHours[] = [1, 4, 8, 24, 48, 168];
const HOUR_MS = 60 * 60 * 1_000;

/**
 * Partage d'une base distante par fichier `.quarkshare`.
 *
 * Chez l'auteur : le fichier est produit depuis un profil du coffre, avec ses
 * identifiants (ou ceux saisis pour ce partage) et ses restrictions.
 * Chez le destinataire : il est ouvert, jamais importé ; la connexion devient une
 * connexion partagée (`Window.share`), dont le main masque l'adresse et limite
 * les opérations.
 */
@Injectable({ lifetime: "singleton" })
export class ShareService {
    private readonly application = inject(Application);
    private readonly connections = inject(ConnectionsService);
    private consumed: ConsumedShares | null = null;

    /**
     * Crée un fichier de partage choisi par l'utilisateur.
     * @returns `false` si l'utilisateur a annulé l'enregistrement.
     * @throws Si le profil n'existe pas ou n'est pas une base distante.
     */
    public async create(senderId: number, body: R_ShareCreateBody): Promise<boolean> {
        const profile = this.connections.store.getProfile(body.profileId);

        if (!profile) {
            throw new NotFoundException(`Connection profile not found: ${body.profileId}`);
        }

        const name = body.name.trim();

        if (!name) {
            throw new Error("The share name cannot be empty");
        }

        if (body.expiresInHours !== null && !EXPIRY_HOURS.includes(body.expiresInHours)) {
            throw new Error(`Unsupported share duration: ${body.expiresInHours}`);
        }

        const createdAt = Date.now();
        const payload: SharePayload = {
            id: randomUUID(),
            name,
            readOnly: body.readOnly,
            singleUse: body.singleUse,
            createdAt,
            expiresAt: body.expiresInHours === null ? undefined : createdAt + body.expiresInHours * HOUR_MS,
            target: shareTarget(profile, body),
        };

        // Chiffré avant d'ouvrir le dialogue : un mot de passe refusé n'y fait pas
        // choisir un emplacement pour rien.
        const content = await encryptShare(payload, body.password);

        const result = await dialog.showSaveDialog(this.parentWindow(senderId), {
            title: "Share connection",
            defaultPath: `${sanitizeFileName(name)}.${SHARE_FILE_EXTENSION}`,
            filters: [{ name: "Quark share", extensions: [SHARE_FILE_EXTENSION] }],
        });

        if (result.canceled || !result.filePath) {
            return false;
        }

        await writeFile(result.filePath, content, "utf-8");
        return true;
    }

    /**
     * Secret enregistré d'un profil partageable (vide s'il n'en a pas).
     * @throws Si le profil n'existe pas ou n'est pas une base distante.
     */
    public profileSecret(profileId: string): string {
        const profile = this.connections.store.getProfile(profileId);

        if (!profile) {
            throw new NotFoundException(`Connection profile not found: ${profileId}`);
        }

        // Même contrôle que la création : un fichier local ne se partage pas.
        shareTarget(profile, {});

        return profile.password ?? "";
    }

    /**
     * Ouvre un fichier de partage dans la fenêtre appelante.
     *
     * Les refus sont renvoyés comme résultat plutôt que levés : ce sont des issues
     * normales, que l'interface explique, et non des erreurs à journaliser.
     */
    public async open(senderId: number, filePath: string, password: string): Promise<R_ShareOpenResponse> {
        const window = this.application.requireWindow(senderId);
        let payload: SharePayload;

        try {
            payload = await decryptShare(await readFile(filePath, "utf-8"), password);
        }
        catch (error) {
            if (error instanceof ShareWrongPasswordError) {
                return { ok: false, reason: "wrong-password" };
            }

            return { ok: false, reason: "invalid", detail: error instanceof ShareInvalidFileError ? error.message : undefined };
        }

        let clockOffsetMs = 0;

        if (payload.expiresAt !== undefined) {
            try {
                const now = await fetchOnlineTime();
                clockOffsetMs = now - Date.now();

                if (now >= payload.expiresAt) {
                    return { ok: false, reason: "unavailable" };
                }
            }
            catch (error) {
                if (error instanceof OnlineClockUnavailableError) {
                    return { ok: false, reason: "clock-unavailable" };
                }

                throw error;
            }
        }

        if (payload.singleUse && this.consumedShares().has(payload.id)) {
            return { ok: false, reason: "unavailable" };
        }

        const share = { name: payload.name, readOnly: payload.readOnly, expiresAt: payload.expiresAt ?? null };

        try {
            await this.connect(window, payload.target, { ...share, clockOffsetMs });
        }
        catch (error) {
            // Le message a déjà été expurgé par le driver de la fenêtre.
            return { ok: false, reason: "connection-failed", detail: describeConnectionError(error) };
        }

        // Consommé seulement une fois la connexion réussie : une coupure réseau ne
        // doit pas « brûler » le partage.
        if (payload.singleUse) {
            await this.consumedShares().add(payload.id);
        }

        this.application.rememberRecentShare(filePath, payload.name, payload.target.driverType);
        Logger.info("Shared connection opened.");

        return {
            ok: true,
            share,
            driverType: payload.target.driverType,
            // Une base SQLite, même distante, renvoie son schéma d'un bloc ; celui
            // d'un serveur est chargé à part par le renderer.
            database: payload.target.driverType === "libsql" ? await window.getDatabaseSchema() : null,
        };
    }

    /**
     * Ouvre la cible du partage. Session partagée et masquage sont posés avant la
     * connexion : le titre n'affiche jamais le nom réel de la base, et un éventuel
     * message d'erreur est déjà expurgé.
     */
    private async connect(window: Window, target: DriverConnectionTarget, session: ShareSession): Promise<void> {
        await window.setDriverType(target.driverType);
        window.beginShareSession(session);
        window.database.setRedactions(connectionSecrets(target));

        try {
            await window.database.configureConnection({ ...target.options, confidential: true });
            await window.openDatabase(target.location);
        }
        catch (error) {
            // Lève aussi la session partagée et le masquage.
            await window.closeDatabase().catch(() => undefined);
            throw error;
        }
    }

    /** Registre créé à la première ouverture : `userData` n'est définitif qu'après le démarrage. */
    private consumedShares(): ConsumedShares {
        this.consumed ??= new ConsumedShares();
        return this.consumed;
    }

    private parentWindow(senderId: number): BrowserWindow {
        return this.application.getWindowBySenderId(senderId)?.browserWindow ?? BrowserWindow.getFocusedWindow()!;
    }
}

function sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "share";
}
