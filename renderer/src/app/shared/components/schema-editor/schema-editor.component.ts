/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import type { FieldDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { SelectComponent } from "@ui/select/select.component";
import { SelectOptionComponent } from "@ui/select/select-option/select-option.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

/** État éditable d'une colonne (pour le renommage). */
interface EditableColumn {
    original: FieldDef;
    newName: string;
    markedForDrop: boolean;
}

/**
 * Modal d'édition de schéma de table (ALTER TABLE).
 * Permet de renommer ou supprimer des colonnes, et d'ajouter de nouvelles colonnes.
 */
@Component({
    selector: "app-schema-editor",
    standalone: true,
    templateUrl: "./schema-editor.component.html",
    styleUrl: "./schema-editor.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent, SelectComponent, SelectOptionComponent, TooltipDirective],
})
export class SchemaEditorComponent implements OnInit {
    protected readonly i18n = inject(I18nService);
    protected readonly state = inject(StateService);
    protected readonly isNoSql = computed(() => this.state.isNoSqlDatabase());

    /** Nom de la table. */
    public readonly tableName = input.required<string>();

    /** Colonnes actuelles de la table. */
    public readonly fields = input.required<FieldDef[]>();

    /** Callback de fermeture. */
    public dismiss?: (data?: { changed: boolean } | null) => void;

    protected readonly editableColumns = signal<EditableColumn[]>([]);
    protected readonly newTableName = signal<string>("");
    protected readonly newColumnName = signal<string>("");
    protected readonly newColumnType = signal<string>("TEXT");
    protected readonly newColumnNotNull = signal<boolean>(false);
    protected readonly newColumnDefault = signal<string>("");
    protected readonly showAddColumn = signal<boolean>(false);
    protected readonly isSaving = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly columnTypes = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATE", "DATETIME"];

    public ngOnInit(): void {
        this.newTableName.set(this.tableName());
        this.editableColumns.set(
            this.fields().map(f => ({ original: f, newName: f.name, markedForDrop: false }))
        );
    }

    /**
     * Collecte toutes les opérations ALTER TABLE à effectuer et retourne un résumé.
     */
    protected getPendingChanges(): string[] {
        const changes: string[] = [];

        if (this.newTableName() !== this.tableName()) {
            changes.push(`RENAME TABLE → ${this.newTableName()}`);
        }

        for (const col of this.editableColumns()) {
            if (col.markedForDrop) {
                changes.push(`DROP COLUMN ${col.original.name}`);
            }
            else if (col.newName !== col.original.name) {
                changes.push(`RENAME COLUMN ${col.original.name} → ${col.newName}`);
            }
        }

        if (this.showAddColumn() && this.newColumnName().trim()) {
            changes.push(`ADD COLUMN ${this.newColumnName()} ${this.newColumnType()}`);
        }

        return changes;
    }

    /**
     * Confirme et applique les changements.
     * Retourne les actions à effectuer au parent.
     */
    protected confirm(): void {
        const changes = this.getPendingChanges();
        if (changes.length === 0) {
            this.dismiss?.(null);
            return;
        }

        this.dismiss?.({ changed: true });
    }

    /**
     * Annule et ferme le modal.
     */
    protected cancel(): void {
        this.dismiss?.(null);
    }

    /** Retourne les actions ALTER TABLE à exécuter. */
    public getAlterActions(): import("@shared/types").R_AlterTableAction[] {
        const table = this.tableName();
        const actions: import("@shared/types").R_AlterTableAction[] = [];

        // D'abord les suppressions
        for (const col of this.editableColumns()) {
            if (col.markedForDrop && !col.original.pk) {
                actions.push({ action: "drop-column", table, column: col.original.name });
            }
        }

        // Puis les renommages
        for (const col of this.editableColumns()) {
            if (!col.markedForDrop && col.newName !== col.original.name && col.newName.trim()) {
                actions.push({ action: "rename-column", table, column: col.original.name, newName: col.newName });
            }
        }

        // Ajout de colonne
        if (this.showAddColumn() && this.newColumnName().trim()) {
            actions.push({
                action: "add-column",
                table,
                column: {
                    name: this.newColumnName(),
                    type: this.newColumnType(),
                    notNull: this.newColumnNotNull(),
                    defaultValue: this.newColumnDefault() || null,
                    primaryKey: false,
                    unique: false,
                },
            });
        }

        // Renommage de table en dernier
        if (this.newTableName() !== table && this.newTableName().trim()) {
            actions.push({ action: "rename-table", table, newName: this.newTableName() });
        }

        return actions;
    }

    /** Bascule l'état "à supprimer" d'une colonne. */
    protected toggleDrop(col: EditableColumn): void {
        if (col.original.pk) {
            return; // Interdit de supprimer la PK
        }

        this.editableColumns.update(cols =>
            cols.map(c => c === col ? { ...c, markedForDrop: !c.markedForDrop } : c)
        );
    }
}
