/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import type { FieldDef, IndexDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";

/**
 * Modal de visualisation et gestion des index d'une table.
 */
@Component({
    selector: "app-index-viewer",
    standalone: true,
    templateUrl: "./index-viewer.component.html",
    styleUrl: "./index-viewer.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent, InputComponent],
})
export class IndexViewerComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    /** Nom de la table. */
    public readonly tableName = input.required<string>();

    /** Colonnes de la table (pour la création d'index). */
    public readonly fields = input.required<FieldDef[]>();

    /** Callback de fermeture. */
    public dismiss?: (data?: { changed: boolean } | null) => void;

    protected readonly indexes = signal<IndexDef[]>([]);
    protected readonly isLoading = signal<boolean>(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly showCreateForm = signal<boolean>(false);

    // Formulaire de création d'index
    protected readonly newIndexName = signal<string>("");
    protected readonly newIndexUnique = signal<boolean>(false);
    protected readonly newIndexColumns = signal<Set<string>>(new Set());
    protected readonly hasChanges = signal<boolean>(false);

    public async ngOnInit(): Promise<void> {
        await this.loadIndexes();
    }

    /**
     * Charge les index de la table.
     */
    private async loadIndexes(): Promise<void> {
        this.isLoading.set(true);
        this.errorMessage.set(null);
        try {
            const result = await this.dbService.getIndexes(this.tableName());
            this.indexes.set(result);
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Supprime un index.
     */
    protected async dropIndex(indexName: string): Promise<void> {
        this.isLoading.set(true);
        this.errorMessage.set(null);
        try {
            await this.dbService.dropIndex(indexName);
            this.hasChanges.set(true);
            await this.loadIndexes();
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Crée un nouvel index.
     */
    protected async createIndex(): Promise<void> {
        const name = this.newIndexName().trim();
        const columns = Array.from(this.newIndexColumns());

        if (!name || columns.length === 0) {
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);
        try {
            await this.dbService.createIndex(this.tableName(), name, columns, this.newIndexUnique());
            this.hasChanges.set(true);
            this.showCreateForm.set(false);
            this.newIndexName.set("");
            this.newIndexColumns.set(new Set());
            this.newIndexUnique.set(false);
            await this.loadIndexes();
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
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
            if (next.has(colName)) {
                next.delete(colName);
            }
            else {
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
            case "u": return "UNIQUE constraint";
            case "pk": return "PRIMARY KEY";
            default: return origin;
        }
    }

    protected close(): void {
        this.dismiss?.({ changed: this.hasChanges() });
    }
}
