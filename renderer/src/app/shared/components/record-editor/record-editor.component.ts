/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
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
import type { DbRecord, FieldDef } from "@shared/types";

/**
 * Mode d'ouverture de l'éditeur de record.
 */
export type RecordEditorMode = "create" | "edit" | "duplicate";

/**
 * Représente un champ du formulaire avec ses métadonnées.
 */
interface FormField {
    def: FieldDef;
    value: string;
    disabled: boolean;
}

/**
 * Composant injecté dans un modal pour éditer, créer ou dupliquer un record.
 */
@Component({
    selector: "app-record-editor",
    standalone: true,
    templateUrl: "./record-editor.component.html",
    styleUrl: "./record-editor.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent],
})
export class RecordEditorComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    public readonly mode = input.required<RecordEditorMode>();
    public readonly record = input<DbRecord | null>(null);
    public readonly fields = input.required<FieldDef[]>();

    protected readonly formFields = signal<FormField[]>([]);
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

        const formFields: FormField[] = fieldDefs.map(def => {
            let value = "";
            let disabled = false;

            if (currentRecord && (currentMode === "edit" || currentMode === "duplicate")) {
                const rawVal = currentRecord[def.name];
                value = rawVal === null || rawVal === undefined ? "" : String(rawVal);
            }

            // En mode create/duplicate, on désactive la PK auto-incrémentée
            if (def.pk && currentMode !== "edit") {
                disabled = true;
                value = "";
            }

            // En mode edit, la PK est toujours en lecture seule
            if (def.pk && currentMode === "edit") {
                disabled = true;
            }

            return { def, value, disabled };
        });

        this.formFields.set(formFields);
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
                        await this.dbService.updateCell(rowid, column, value);
                    }
                }
            }
            else {
                await this.dbService.insertRow(values);
            }

            this.dismiss?.({ role: "confirm" });
        }
        catch (err) {
            this.error.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.saving.set(false);
        }
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
    protected getPlaceholder(field: FieldDef): string {
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
