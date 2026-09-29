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

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { FieldDef, IndexDef } from "@shared/types";
import { AlertController } from "@ui/alert/alert.controller";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { SettingsService } from "src/app/core/services/settings.service";
import { StateService } from "src/app/core/services/state.service";
import { indexesTabTable, TabsService } from "src/app/core/services/tabs.service";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";

/**
 * Onglet « Index · table » : liste, création et suppression des index d'une table.
 *
 * Routé sur `/dashboard/indexes` ; la table est celle de l'onglet actif
 * (`__indexes__:<table>`, voir `indexesTabId`), si bien qu'un seul composant
 * sert tous les onglets d'index et se recharge au changement d'onglet.
 */
@Component({
    selector: "app-index-viewer",
    standalone: true,
    templateUrl: "./index-viewer.component.html",
    styleUrl: "./index-viewer.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent],
})
export class IndexViewerComponent {
    private readonly dbService = inject(DatabaseService);
    private readonly tabs = inject(TabsService);
    private readonly state = inject(StateService);
    private readonly settings = inject(SettingsService);
    private readonly alertCtrl = inject(AlertController);
    protected readonly i18n = inject(I18nService);

    /** Table de l'onglet actif, `null` si l'onglet actif n'est pas un onglet d'index. */
    protected readonly tableName = computed(() => indexesTabTable(this.tabs.activeTab()?.tableName));

    /** Colonnes de la table, proposées à la création d'un index. */
    protected readonly fields = computed<FieldDef[]>(() => {
        const table = this.tableName();

        return this.state.database()?.tables.find(candidate => candidate.name === table)?.fields ?? [];
    });

    /** L'édition du schéma est possible : base en écriture et driver compatible. */
    protected readonly canEdit = computed(() => {
        const schemaEditing = this.state.capabilities()?.schemaEditing ?? true;

        return schemaEditing && !this.dbService.readOnly();
    });

    protected readonly indexes = signal<IndexDef[]>([]);
    protected readonly isLoading = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly showCreateForm = signal<boolean>(false);

    // Formulaire de création d'index
    protected readonly newIndexName = signal<string>("");
    protected readonly newIndexUnique = signal<boolean>(false);
    protected readonly newIndexColumns = signal<ReadonlySet<string>>(new Set());

    protected readonly canCreate = computed(() => {
        return !this.isLoading() && this.newIndexName().trim().length > 0 && this.newIndexColumns().size > 0;
    });

    public constructor() {
        effect(() => {
            const table = this.tableName();

            untracked(() => {
                this.resetForm();
                this.indexes.set([]);

                if (table !== null) {
                    void this.loadIndexes(table);
                }
            });
        });
    }

    /**
     * Supprime un index, après confirmation si les suppressions doivent être confirmées.
     */
    protected async dropIndex(indexName: string): Promise<void> {
        if (!this.settings.settings().confirmDeletions) {
            await this.performDrop(indexName);
            return;
        }

        await this.alertCtrl.create({
            title: this.i18n.t("indexViewer.dropTitle", { name: indexName }),
            message: this.i18n.t("indexViewer.dropMessage"),
            color: "danger",
            actions: [
                { text: this.i18n.t("editor.cancel"), role: "cancel" },
                {
                    text: this.i18n.t("indexViewer.drop"),
                    role: "destructive",
                    color: "danger",
                    handler: self => {
                        self.dismiss({ role: "destructive" });
                        void this.performDrop(indexName);
                    },
                },
            ],
        });
    }

    /**
     * Crée un nouvel index.
     */
    protected async createIndex(): Promise<void> {
        const table = this.tableName();
        const name = this.newIndexName().trim();
        const columns = Array.from(this.newIndexColumns());

        if (table === null || !name || columns.length === 0) {
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            await this.dbService.createIndex(table, name, columns, this.newIndexUnique());
            this.resetForm();
            await this.loadIndexes(table);
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Toggle la sélection d'une colonne pour le nouvel index.
     */
    protected toggleColumn(colName: string): void {
        this.newIndexColumns.update(set => {
            const next = new Set(set);

            if (!next.delete(colName)) {
                next.add(colName);
            }

            return next;
        });
    }

    protected isColumnSelected(colName: string): boolean {
        return this.newIndexColumns().has(colName);
    }

    /**
     * Retourne un libellé d'origine pour un index.
     */
    protected getOriginLabel(origin: string): string {
        switch (origin) {
            case "c": return "CREATE INDEX";
            case "u": return "UNIQUE";
            case "pk": return "PRIMARY KEY";
            default: return origin;
        }
    }

    /**
     * Charge les index de la table.
     */
    private async loadIndexes(table: string): Promise<void> {
        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            const result = await this.dbService.getIndexes(table);

            // L'onglet a pu changer pendant la lecture.
            if (this.tableName() === table) {
                this.indexes.set(result);
            }
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Supprime un index puis recharge la liste.
     */
    private async performDrop(indexName: string): Promise<void> {
        const table = this.tableName();

        if (table === null) {
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            await this.dbService.dropIndex(indexName);
            await this.loadIndexes(table);
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Vide le formulaire de création.
     */
    private resetForm(): void {
        this.showCreateForm.set(false);
        this.newIndexName.set("");
        this.newIndexColumns.set(new Set());
        this.newIndexUnique.set(false);
    }
}
