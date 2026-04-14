/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { ButtonComponent } from "@ui/button/button.component";
import type { TableSchema } from "@shared/types";

/** Représente le SQL de création d'une table. */
interface TableSchemaSql {
    name: string;
    sql: string;
}

/**
 * Modal d'affichage du schéma complet de la base de données.
 * Affiche le DDL de chaque table et permet de le copier ou exporter.
 */
@Component({
    selector: "app-database-schema",
    standalone: true,
    templateUrl: "./database-schema.component.html",
    styleUrl: "./database-schema.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent],
})
export class DatabaseSchemaComponent {
    private readonly dbService = inject(DatabaseService);
    private readonly state = inject(StateService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: () => void;

    /** Indique si le "Copié !" est visible. */
    protected readonly copied = signal<boolean>(false);

    /** DDL de toutes les tables construit depuis le schéma en mémoire. */
    protected readonly schemaSqls = computed<TableSchemaSql[]>(() => {
        const db = this.state.database();
        if (!db) {
            return [];
        }
        return db.tables.map(t => ({
            name: t.name,
            sql: this.generateCreateSql(t),
        }));
    });

    protected close(): void {
        this.dismiss?.();
    }

    /**
     * Copie tout le schéma dans le presse-papier.
     */
    protected async copyAll(): Promise<void> {
        const allSql = this.schemaSqls().map(s => `-- ${s.name}\n${s.sql};`).join("\n\n");
        await navigator.clipboard.writeText(allSql);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
    }

    /**
     * Exporte le schéma complet en fichier .sql.
     */
    protected exportSql(): void {
        const allSql = this.schemaSqls().map(s => `-- ${s.name}\n${s.sql};`).join("\n\n");
        const blob = new Blob([allSql], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const dbName = this.state.database()?.name ?? "schema";
        a.href = url;
        a.download = `${dbName}.sql`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Génère le SQL CREATE TABLE depuis le schéma Angular en mémoire.
     */
    private generateCreateSql(table: TableSchema): string {
        const cols = table.fields.map(f => {
            let def = `    ${this.quoteIdent(f.name)} ${f.type || "TEXT"}`;
            if (f.pk) {
                def += " PRIMARY KEY";
            }
            if (f.notnull && !f.pk) {
                def += " NOT NULL";
            }
            if (f.dflt_value !== null && f.dflt_value !== undefined) {
                def += ` DEFAULT ${f.dflt_value}`;
            }
            if (f.fk) {
                def += ` REFERENCES ${this.quoteIdent(f.fk.table)}(${this.quoteIdent(f.fk.column)})`;
            }
            return def;
        });

        return `CREATE TABLE ${this.quoteIdent(table.name)} (\n${cols.join(",\n")}\n)`;
    }

    /** Échappe un identifiant SQLite. */
    private quoteIdent(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }
}
