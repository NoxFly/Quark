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

import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { ButtonComponent } from "@ui/button/button.component";
import type { TableSchemaSql } from "src/app/core/models/database-schema.model";

/**
 * Modal d'affichage du schéma complet de la base de données.
 * Affiche le DDL de chaque table (récupéré depuis sqlite_master) et permet de le copier ou exporter.
 */
@Component({
    selector: "app-database-schema",
    standalone: true,
    templateUrl: "./database-schema.component.html",
    styleUrl: "./database-schema.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent],
})
export class DatabaseSchemaComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: () => void;

    /** Indique si le "Copié !" est visible. */
    protected readonly copied = signal<boolean>(false);

    /** DDL de toutes les tables récupéré depuis sqlite_master. */
    protected readonly schemaSqls = signal<TableSchemaSql[]>([]);

    public async ngOnInit(): Promise<void> {
        const rows = await this.noxus.ipc.getTablesSql();
        this.schemaSqls.set(rows);
    }

    protected close(): void {
        this.dismiss?.();
    }

    /**
     * Copie tout le schéma dans le presse-papier.
     */
    protected async copyAll(): Promise<void> {
        const allSql = this.schemaSqls().map(s => `${s.sql};`).join("\n\n");
        await navigator.clipboard.writeText(allSql);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
    }

    /**
     * Exporte le schéma complet en fichier .sql.
     */
    protected exportSql(): void {
        const allSql = this.schemaSqls().map(s => `${s.sql};`).join("\n\n");
        const blob = new Blob([allSql], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "schema.sql";
        a.click();
        URL.revokeObjectURL(url);
    }
}
