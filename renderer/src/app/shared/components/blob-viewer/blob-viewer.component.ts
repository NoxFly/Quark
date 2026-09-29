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

import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import type { UIDismissData } from "src/app/shared/ui/ui.types";

/**
 * Composant modal pour visualiser une image stockée en BLOB dans la base de données.
 * Reçoit les données binaires brutes et les affiche dans un `<img>`.
 */
@Component({
    selector: "app-blob-viewer",
    standalone: true,
    templateUrl: "./blob-viewer.component.html",
    styleUrl: "./blob-viewer.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlobViewerComponent {
    /** URL objet de l'image à afficher. */
    public readonly imageUrl = signal<string | null>(null);

    /** Nom du champ (affiché dans le titre). */
    public readonly fieldName = signal<string>("");

    /** Callback de fermeture fourni par le ModalController. */
    public dismiss: (e?: Partial<UIDismissData>) => void = () => {};

    /**
     * Charge les données BLOB et crée une URL objet pour affichage.
     * Accepte un Buffer sérialisé `{ type: 'Buffer', data: number[] }`,
     * un Uint8Array, ou un ArrayBuffer.
     */
    public loadBlob(data: unknown, fieldName: string): void {
        this.fieldName.set(fieldName);

        let bytes: Uint8Array;

        if (data instanceof Uint8Array) {
            bytes = data;
        }
        else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        }
        else if (typeof data === "object" && data !== null && "data" in data && Array.isArray((data as any).data)) {
            // Buffer sérialisé par Electron IPC : { type: 'Buffer', data: number[] }
            bytes = new Uint8Array((data as { data: number[] }).data);
        }
        else {
            return;
        }

        const blob = new Blob([bytes.buffer as ArrayBuffer]);
        this.imageUrl.set(URL.createObjectURL(blob));
    }

    /**
     * Libère l'URL objet et ferme la modale.
     */
    public close(): void {
        const url = this.imageUrl();
        if (url) {
            URL.revokeObjectURL(url);
        }
        this.dismiss({ role: "cancel" });
    }
}
