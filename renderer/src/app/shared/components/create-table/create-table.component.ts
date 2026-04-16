/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import type { CreateTableColumnDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";

/**
 * Modal de création d'une nouvelle table SQLite.
 */
@Component({
    selector: "app-create-table",
    standalone: true,
    templateUrl: "./create-table.component.html",
    styleUrl: "./create-table.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent],
})
export class CreateTableComponent implements OnInit {
    protected readonly i18n = inject(I18nService);
    protected readonly state = inject(StateService);
    protected readonly isNoSql = computed(() => this.state.isNoSqlDatabase());

    /** Callback de fermeture. */
    public dismiss?: (data?: { tableName: string; columns: CreateTableColumnDef[] } | null) => void;

    protected readonly tableName = signal<string>("");
    protected readonly columns = signal<CreateTableColumnDef[]>([]);

    protected readonly columnTypes = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATE", "DATETIME"];

    protected readonly sqlPreview = computed(() => {
        const name = this.tableName().trim();
        if (!name || this.columns().length === 0) {
            return "";
        }

        const cols = this.columns();
        const pkCols = cols.filter(c => c.primaryKey);
        const hasSinglePk = pkCols.length === 1;
        const hasCompositePk = pkCols.length > 1;

        const colDefs = cols.map(col => {
            let def = `  "${col.name}" ${col.type}`;
            if (hasSinglePk && col.primaryKey) {
                def += " PRIMARY KEY";
            }
            if (col.notNull && !col.primaryKey) {
                def += " NOT NULL";
            }
            if (col.unique && !col.primaryKey) {
                def += " UNIQUE";
            }
            if (col.defaultValue) {
                def += ` DEFAULT ${col.defaultValue}`;
            }
            return def;
        });

        if (hasCompositePk) {
            const pkNames = pkCols.map(c => `"${c.name}"`).join(", ");
            colDefs.push(`  PRIMARY KEY (${pkNames})`);
        }

        return `CREATE TABLE "${name}" (\n${colDefs.join(",\n")}\n);`;
    });

    public ngOnInit(): void {
        // Ajouter une colonne ID par défaut
        this.addColumn();
        const cols = this.columns();
        if (cols.length > 0) {
            this.columns.update(c => c.map((col, i) => i === 0 ? { ...col, name: "id", type: "INTEGER", primaryKey: true } : col));
        }
    }

    /**
     * Ajoute une nouvelle colonne avec des valeurs par défaut.
     */
    protected addColumn(): void {
        const newCol: CreateTableColumnDef = {
            name: "",
            type: "TEXT",
            notNull: false,
            defaultValue: null,
            primaryKey: false,
            unique: false,
        };
        this.columns.update(cols => [...cols, newCol]);
    }

    /**
     * Supprime une colonne à l'index donné.
     */
    protected removeColumn(index: number): void {
        this.columns.update(cols => cols.filter((_, i) => i !== index));
    }

    /**
     * Met à jour un champ d'une colonne.
     */
    protected updateColumn(index: number, field: keyof CreateTableColumnDef, value: unknown): void {
        this.columns.update(cols =>
            cols.map((col, i) => i === index ? { ...col, [field]: value } : col)
        );
    }

    /**
     * Valide et confirme la création.
     */
    protected confirm(): void {
        const name = this.tableName().trim();
        const cols = this.columns();

        if (!name || cols.length === 0) {
            return;
        }

        if (cols.some(c => !c.name.trim())) {
            return;
        }

        this.dismiss?.({ tableName: name, columns: cols });
    }

    /**
     * Annule et ferme le modal.
     */
    protected cancel(): void {
        this.dismiss?.(null);
    }

    protected isValid(): boolean {
        const name = this.tableName().trim();
        const cols = this.columns();
        return name.length > 0 && cols.length > 0 && cols.every(c => c.name.trim().length > 0);
    }
}
