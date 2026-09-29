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

import {
    ChangeDetectionStrategy,
    Component,
    inject,
    input,
    OnInit,
    signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import type { DbRecord, FieldDef } from "@shared/types";
import { isTextType } from "src/app/shared/helpers/data-grid.helper";
import type { PrimaryKeyKind, RecordEditorMode, RecordFormField } from "src/app/shared/components/record-editor/record-editor.model";

/** UUID canonique, tel que produit par `crypto.randomUUID()`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Composant injecté dans un modal pour éditer, créer ou dupliquer un record.
 */
@Component({
    selector: "app-record-editor",
    standalone: true,
    templateUrl: "./record-editor.component.html",
    styleUrl: "./record-editor.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent, TooltipDirective],
})
export class RecordEditorComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    public readonly mode = input.required<RecordEditorMode>();
    public readonly record = input<DbRecord | null>(null);
    public readonly fields = input.required<FieldDef[]>();

    protected readonly formFields = signal<RecordFormField[]>([]);
    protected readonly saving = signal<boolean>(false);
    protected readonly error = signal<string | null>(null);

    /** Référence au dismiss du parent modal — sera injectée via componentProps. */
    public dismiss?: (data?: { role: string; data?: unknown }) => void;

    /**
     * Initialise les champs du formulaire.
     */
    public ngOnInit(): void {
        const currentRecord = this.record();
        const currentMode = this.mode();
        const fieldDefs = this.fields();

        const formFields: RecordFormField[] = fieldDefs.map(def => {
            let value = "";

            if (currentRecord && (currentMode === "edit" || currentMode === "duplicate")) {
                const rawVal = currentRecord[def.name];
                value = rawVal === null || rawVal === undefined ? "" : String(rawVal);
            }

            if (!def.pk) {
                return { def, value, disabled: false, placeholder: this.getPlaceholder(def), autoFilled: false };
            }

            // En mode edit, la PK identifie la ligne : elle reste en lecture seule.
            if (currentMode === "edit") {
                return { def, value, disabled: true, placeholder: this.getPlaceholder(def), autoFilled: false };
            }

            return this.buildPrimaryKeyField(def);
        });

        this.formFields.set(formFields);
    }

    /**
     * Construit le champ d'une clé primaire pour une création ou une duplication.
     *
     * Toutes les clés primaires étaient jusqu'ici désactivées et omises de
     * l'insertion, en supposant qu'elles étaient auto-incrémentées. Une clé
     * textuelle échouait donc sur sa contrainte NOT NULL, sans que l'utilisateur
     * puisse la renseigner.
     */
    private buildPrimaryKeyField(def: FieldDef): RecordFormField {
        switch (this.detectPrimaryKeyKind(def)) {
            case "autoincrement":
                // Omise de l'insertion : c'est SQLite qui attribue la valeur.
                return {
                    def,
                    value: "",
                    disabled: true,
                    placeholder: this.i18n.t("editor.autoAssigned"),
                    autoFilled: true,
                };

            case "uuid":
                // Généré ici et non à l'envoi : l'utilisateur voit la valeur qui
                // sera écrite, et reste libre de la remplacer.
                return {
                    def,
                    value: randomUuid(),
                    disabled: false,
                    placeholder: this.getPlaceholder(def),
                    autoFilled: true,
                };

            case "manual":
                return {
                    def,
                    value: "",
                    disabled: false,
                    placeholder: this.getPlaceholder(def),
                    autoFilled: false,
                };
        }
    }

    /**
     * Détermine comment la valeur d'une clé primaire doit être obtenue.
     */
    private detectPrimaryKeyKind(def: FieldDef): PrimaryKeyKind {
        if (def.type.toUpperCase().includes("INT")) {
            return "autoincrement";
        }

        return this.columnHoldsUuid(def.name) ? "uuid" : "manual";
    }

    /**
     * Indique si une colonne porte des UUID.
     *
     * Le type SQL ne le dit pas : la preuve vient des données. La ligne dupliquée
     * fait foi quand elle existe, sinon les lignes déjà chargées de la table.
     *
     * @param column - Nom de la colonne à examiner.
     */
    private columnHoldsUuid(column: string): boolean {
        const source = this.record()?.[column];

        if (typeof source === "string") {
            return UUID_PATTERN.test(source);
        }

        for (const row of this.dbService.tableData()) {
            const value = row[column];

            if (typeof value === "string") {
                return UUID_PATTERN.test(value);
            }
        }

        return false;
    }

    /**
     * Remplace la valeur d'un champ par un nouvel UUID.
     */
    protected regenerateUuid(index: number): void {
        this.onFieldChange(index, randomUuid());
    }

    /**
     * Retourne le titre du modal selon le mode.
     * En mode NoSQL, les termes "record" sont remplacés par "document".
     */
    protected getTitle(): string {
        const nosql = this.state.isNoSqlDatabase();
        switch (this.mode()) {
            case "create":
                return this.i18n.t(nosql ? "editor.createTitle.nosql" : "editor.createTitle");
            case "edit":
                return this.i18n.t(nosql ? "editor.editTitle.nosql" : "editor.editTitle");
            case "duplicate":
                return this.i18n.t(nosql ? "editor.duplicateTitle.nosql" : "editor.duplicateTitle");
        }
    }

    /**
     * Met à jour la valeur d'un champ dans le formulaire.
     */
    protected onFieldChange(index: number, value: string): void {
        this.formFields.update(fields => {
            const updated = [...fields];
            const existing = updated[index];
            if (existing) {
                updated[index] = { ...existing, value };
            }
            return updated;
        });
    }

    /**
     * Sauvegarde le record (création, modification ou duplication).
     */
    protected async save(): Promise<void> {
        this.saving.set(true);
        this.error.set(null);

        try {
            const values: Record<string, unknown> = {};
            const currentMode = this.mode();

            for (const field of this.formFields()) {
                if (field.disabled) {
                    continue;
                }

                // Convertir les valeurs vides en null pour les champs nullables
                if (field.value === "" && !field.def.notnull) {
                    values[field.def.name] = null;
                }
                else {
                    values[field.def.name] = this.parseValue(field.value, field.def.type);
                }
            }

            if (currentMode === "edit") {
                const currentRecord = this.record();
                if (currentRecord) {
                    const rowid = currentRecord["rowid"] as number;
                    for (const [column, value] of Object.entries(values)) {
                        // Seuls les champs modifiés sont écrits : la ligne n'est
                        // marquée modifiée que si elle l'est vraiment.
                        if (value !== currentRecord[column]) {
                            await this.dbService.updateCell(rowid, column, value);
                        }
                    }
                }

                this.dismiss?.({ role: "confirm" });
            }
            else {
                const inserted = await this.dbService.insertRow(values);
                // La page sélectionne la ligne créée à partir de son rowid.
                this.dismiss?.({ role: "confirm", data: { rowid: inserted?.["rowid"] } });
            }
        }
        catch (err) {
            this.error.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.saving.set(false);
        }
    }

    /**
     * Indique si la valeur d'un champ s'affiche en police à chasse fixe.
     */
    protected isMono(def: FieldDef): boolean {
        return !isTextType(def.type);
    }

    /**
     * Annule et ferme le modal.
     */
    protected cancel(): void {
        this.dismiss?.({ role: "cancel" });
    }

    /**
     * Parse une valeur string vers le type approprié selon le type SQL.
     */
    private parseValue(value: string, sqlType: string): unknown {
        const upperType = sqlType.toUpperCase();

        if (upperType.includes("INT") || upperType === "REAL" || upperType === "FLOAT" || upperType === "DOUBLE" || upperType === "NUMERIC") {
            const num = Number(value);
            if (!Number.isNaN(num)) {
                return num;
            }
        }

        return value;
    }

    /**
     * Retourne le placeholder pour un champ.
     */
    private getPlaceholder(field: FieldDef): string {
        const parts: string[] = [field.type];

        if (field.notnull) {
            parts.push("NOT NULL");
        }

        if (field.dflt_value !== null) {
            parts.push(`DEFAULT: ${field.dflt_value}`);
        }

        if (field.fk) {
            parts.push(`FK → ${field.fk.table}.${field.fk.column}`);
        }

        return parts.join(" | ");
    }
}

/**
 * Produit un UUID v4.
 *
 * `crypto.randomUUID` exige un contexte sécurisé ; le repli couvre le cas où il
 * ne l'est pas, plutôt que de laisser le formulaire échouer sur une exception.
 */
function randomUuid(): string {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));

    // Version 4 et variante RFC 4122.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}
