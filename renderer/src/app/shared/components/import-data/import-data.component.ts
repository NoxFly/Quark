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

import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NoxusService } from "src/app/core/services/noxus.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import type { DbRecord } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";
import { SegmentedComponent } from "src/app/shared/ui/components/segmented/segmented.component";
import type { SegmentedOption } from "src/app/shared/ui/ui.types";

/**
 * Modal d'import de données (CSV ou JSON).
 * - Étape 1 : saisir/coller les données ou uploader un fichier
 * - Étape 2 : aperçu des données à importer (diff-like)
 * - Étape 3 : confirmation
 */
@Component({
    selector: "app-import-data",
    standalone: true,
    templateUrl: "./import-data.component.html",
    styleUrl: "./import-data.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, SegmentedComponent],
})
export class ImportDataComponent implements OnInit {
    private readonly noxus = inject(NoxusService);
    protected readonly i18n = inject(I18nService);
    protected readonly state = inject(StateService);

    /** Table cible de l'import. */
    public readonly tableName = input.required<string>();

    /** Callback de fermeture. */
    public dismiss?: (data?: { imported: boolean } | null) => void;

    protected readonly step = signal<1 | 2 | 3>(1);

    /** Formats proposés : leurs noms ne se traduisent pas. */
    protected readonly formatOptions: SegmentedOption<"csv" | "json">[] = [
        { value: "csv", label: "CSV" },
        { value: "json", label: "JSON" },
    ];

    protected readonly modeOptions = computed<SegmentedOption<"insert" | "upsert">[]>(() => [
        { value: "insert", label: this.i18n.t("importData.modeInsert") },
        { value: "upsert", label: this.i18n.t("importData.modeUpsert") },
    ]);
    protected readonly format = signal<"csv" | "json">("csv");
    protected readonly importMode = signal<"insert" | "upsert">("insert");
    protected readonly rawData = signal<string>("");
    protected readonly isLoading = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly previewRows = signal<DbRecord[]>([]);
    protected readonly previewColumns = signal<string[]>([]);
    protected readonly totalRows = signal<number>(0);
    protected readonly parseErrors = signal<string[]>([]);

    public ngOnInit(): void {}

    /**
     * Charge un fichier depuis le disque.
     */
    protected async loadFile(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        const format = file.name.endsWith(".json") ? "json" : "csv";
        this.format.set(format);

        const text = await file.text();
        this.rawData.set(text);
    }

    /**
     * Passe à l'étape 2 (aperçu) en envoyant les données au main pour parsing.
     */
    protected async preview(): Promise<void> {
        const data = this.rawData().trim();
        if (!data) {
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            const response = await this.noxus.ipc.previewImport({
                table: this.tableName(),
                format: this.format(),
                data,
            });

            this.parseErrors.set(response.errors);
            this.totalRows.set(response.totalRows);
            this.previewRows.set(response.preview);

            if (response.preview.length > 0) {
                const firstRow = response.preview[0];
                if (firstRow) {
                    this.previewColumns.set(Object.keys(firstRow).filter(k => k !== "rowid"));
                }
            }

            this.step.set(2);
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Lance l'import effectif.
     */
    protected async doImport(): Promise<void> {
        this.isLoading.set(true);
        this.errorMessage.set(null);

        try {
            await this.noxus.ipc.importData({
                table: this.tableName(),
                format: this.format(),
                data: this.rawData(),
                mode: this.importMode(),
            });

            this.step.set(3);
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Retourne à l'étape 1.
     */
    protected backToStep1(): void {
        this.step.set(1);
        this.errorMessage.set(null);
    }

    /**
     * Ferme le modal en signalant que l'import a eu lieu.
     */
    protected close(imported: boolean): void {
        this.dismiss?.({ imported });
    }

    /**
     * Formate une valeur de prévisualisation.
     */
    protected formatPreviewCell(value: unknown): string {
        if (value === null || value === undefined) {
            return "NULL";
        }
        return String(value);
    }

    protected isNullValue(value: unknown): boolean {
        return value === null || value === undefined;
    }
}
