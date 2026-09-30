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

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron/main";

/**
 * Partages à usage unique déjà ouverts sur ce poste.
 *
 * Sans serveur, c'est une protection dissuasive : un fichier copié avant son
 * ouverture, ou ouvert sur un autre poste, s'ouvrira encore. Seule une empreinte
 * de l'identifiant est conservée, pour que le registre ne dise pas quels partages
 * ont été reçus.
 */
export class ConsumedShares {
    private readonly filePath: string;
    private readonly consumed: Set<string>;

    public constructor(directory: string = app.getPath("userData")) {
        this.filePath = join(directory, "shares.json");
        this.consumed = new Set(this.read());
    }

    public has(shareId: string): boolean {
        return this.consumed.has(fingerprint(shareId));
    }

    /**
     * Marque un partage comme ouvert.
     */
    public async add(shareId: string): Promise<void> {
        this.consumed.add(fingerprint(shareId));
        await writeFile(this.filePath, JSON.stringify([...this.consumed]), "utf-8");
    }

    private read(): string[] {
        if (!existsSync(this.filePath)) {
            return [];
        }

        try {
            const entries = JSON.parse(readFileSync(this.filePath, "utf-8")) as unknown;
            return Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === "string") : [];
        }
        catch {
            return [];
        }
    }
}

function fingerprint(shareId: string): string {
    return createHash("sha256").update(shareId).digest("hex");
}
