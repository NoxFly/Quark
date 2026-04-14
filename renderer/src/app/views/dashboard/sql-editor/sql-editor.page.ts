/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import type { R_SqlExecResponse } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";

/**
 * Page d'éditeur SQL brut.
 * Permet d'exécuter des requêtes SQL arbitraires sur la base de données.
 * Raccourci : Ctrl+Shift+Q
 *
 * Performances : la textarea n'est pas liée via ngModel pour éviter le
 * déclenchement de la détection de changements Angular à chaque frappe.
 * La valeur est lue directement depuis le DOM au moment de l'exécution.
 */
@Component({
    selector: "app-sql-editor",
    standalone: true,
    templateUrl: "./sql-editor.page.html",
    styleUrl: "./sql-editor.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent],
})
export class SqlEditorPage {
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    private readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>("sqlTextarea");

    protected readonly result = signal<R_SqlExecResponse | null>(null);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly isExecuting = signal<boolean>(false);
    protected readonly hasInput = signal<boolean>(false);

    /** Historique des requêtes exécutées (les 20 dernières). */
    protected readonly queryHistory = signal<string[]>([]);
    private historyIndex = -1;

    /** Limite d'affichage des lignes pour éviter le rendu de milliers de lignes. */
    private readonly MAX_DISPLAY_ROWS = 500;

    /** Nombre de colonnes du résultat. */
    protected readonly resultColumns = computed(() => this.result()?.columns ?? []);

    /** Lignes du résultat (limitées à MAX_DISPLAY_ROWS). */
    protected readonly resultRows = computed(() => (this.result()?.rows ?? []).slice(0, this.MAX_DISPLAY_ROWS));

    /** Nombre total de lignes du résultat (avant limitation). */
    protected readonly totalResultRows = computed(() => this.result()?.rows.length ?? 0);

    /** Retourne true si toutes les lignes sont affichées. */
    protected readonly resultTruncated = computed(() => this.totalResultRows() > this.MAX_DISPLAY_ROWS);

    /** Retourne true si le résultat est un SELECT. */
    protected readonly isSelectResult = computed(() => this.result()?.isSelect === true);

    /** Temps d'exécution SQL formaté. */
    protected readonly executionTime = computed(() => {
        const ms = this.result()?.executionTimeMs;
        if (ms === undefined) {
            return null;
        }
        return ms < 1 ? `< 1 ms` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
    });

    /**
     * Retourne le contenu actuel de la textarea.
     */
    private getSql(): string {
        return this.textareaRef()?.nativeElement.value.trim() ?? "";
    }

    /**
     * Exécute la requête SQL courante.
     */
    protected async execute(): Promise<void> {
        const sql = this.getSql();
        if (!sql) {
            return;
        }

        this.isExecuting.set(true);
        this.errorMessage.set(null);
        this.result.set(null);

        try {
            const response = await this.dbService.execSql(sql);
            this.result.set(response);
            this.addToHistory(sql);
        }
        catch (err) {
            this.errorMessage.set(err instanceof Error ? err.message : String(err));
        }
        finally {
            this.isExecuting.set(false);
        }
    }

    /**
     * Efface le résultat et le message d'erreur.
     */
    protected clearResult(): void {
        this.result.set(null);
        this.errorMessage.set(null);
    }

    /**
     * Met à jour `hasInput` quand la textarea change.
     * N'utilise pas ngModel pour éviter la détection de changements à chaque frappe.
     */
    protected onTextareaInput(): void {
        this.hasInput.set(this.getSql().length > 0);
    }

    /**
     * Gère les raccourcis clavier dans l'éditeur.
     * - Ctrl+Enter : exécuter
     * - Ctrl+ArrowUp/Down : naviguer dans l'historique
     */
    protected onEditorKeydown(event: KeyboardEvent): void {
        if (event.ctrlKey && event.key === "Enter") {
            event.preventDefault();
            this.execute();
        }
        else if (event.ctrlKey && event.key === "ArrowUp") {
            event.preventDefault();
            this.navigateHistory(-1);
        }
        else if (event.ctrlKey && event.key === "ArrowDown") {
            event.preventDefault();
            this.navigateHistory(1);
        }
    }

    /**
     * Charge une requête depuis l'historique dans l'éditeur.
     */
    protected loadFromHistory(query: string): void {
        const el = this.textareaRef()?.nativeElement;
        if (el) {
            el.value = query;
            this.hasInput.set(true);
            el.focus();
        }
    }

    /**
     * Formate la valeur d'une cellule de résultat pour l'affichage.
     */
    protected formatCell(value: unknown): string {
        if (value === null || value === undefined) {
            return "NULL";
        }
        if (typeof value === "object") {
            return JSON.stringify(value);
        }
        return String(value);
    }

    /**
     * Retourne true si la valeur est NULL.
     */
    protected isNull(value: unknown): boolean {
        return value === null || value === undefined;
    }

    /**
     * Ajoute une requête à l'historique (dédupliquée, max 20 entrées).
     */
    private addToHistory(sql: string): void {
        this.queryHistory.update(history => {
            const filtered = history.filter(q => q !== sql);
            return [sql, ...filtered].slice(0, 20);
        });
        this.historyIndex = -1;
    }

    /**
     * Navigue dans l'historique des requêtes.
     */
    private navigateHistory(delta: number): void {
        const history = this.queryHistory();
        if (history.length === 0) {
            return;
        }

        this.historyIndex = Math.max(-1, Math.min(history.length - 1, this.historyIndex + delta));

        if (this.historyIndex >= 0) {
            const query = history[this.historyIndex];
            if (query !== undefined) {
                this.loadFromHistory(query);
            }
        }
    }
}
