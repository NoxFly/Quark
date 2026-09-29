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
    afterNextRender,
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    signal,
    viewChild,
} from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { ThemeService } from "src/app/core/services/theme.service";
import type { R_SqlExecResponse } from "@shared/types";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { ButtonComponent } from "@ui/button/button.component";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { VirtualRows } from "src/app/shared/helpers/virtual-rows.helper";

/** Lignes demandées au main à chaque page supplémentaire. */
const RESULT_PAGE_SIZE = 1000;

/** Hauteur de ligne attendue (voir la feuille de style), avant mesure. */
const ESTIMATED_ROW_HEIGHT = 29;

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

/**
 * Page d'éditeur SQL avec Monaco Editor.
 * Permet d'exécuter des requêtes SQL arbitraires sur la base de données.
 * Raccourci : Ctrl+Shift+Q
 *
 * L'éditeur Monaco est chargé dynamiquement via un script AMD loader
 * pré-configuré depuis les assets Angular (`/vs/`).
 */
@Component({
    selector: "app-sql-editor",
    standalone: true,
    templateUrl: "./sql-editor.page.html",
    styleUrl: "./sql-editor.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective, ButtonComponent],
})
export class SqlEditorPage {
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);
    private readonly state = inject(StateService);
    private readonly monacoPreload = inject(MonacoPreloadService);
    private readonly themeService = inject(ThemeService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly editorContainerRef = viewChild<ElementRef<HTMLDivElement>>("monacoContainer");
    private readonly resultsContainerRef = viewChild<ElementRef<HTMLDivElement>>("resultsContainer");

    protected readonly result = signal<R_SqlExecResponse | null>(null);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly isExecuting = signal<boolean>(false);
    protected readonly hasInput = signal<boolean>(false);

    /** Historique des requêtes exécutées (les 20 dernières). */
    protected readonly queryHistory = signal<string[]>([]);
    private historyIndex = -1;

    /** Indique si le panneau d'historique est visible. */
    protected readonly historyVisible = signal<boolean>(false);

    private editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
    private completionDisposable: import("monaco-editor").IDisposable | null = null;

    /** Nombre de colonnes du résultat. */
    protected readonly resultColumns = computed(() => this.result()?.columns ?? []);

    /**
     * Lignes du résultat déjà rapatriées. Le main n'envoie que la première page ;
     * les suivantes sont demandées au fil du défilement.
     */
    protected readonly resultRows = signal<unknown[][]>([]);

    /** Nombre total de lignes du résultat, rapatriées ou non. */
    protected readonly totalResultRows = computed(() => this.result()?.totalRows ?? this.resultRows().length);

    /** Seules les lignes visibles sont rendues. */
    protected readonly virtual = new VirtualRows(computed(() => this.resultRows().length), ESTIMATED_ROW_HEIGHT);

    protected readonly visibleRows = computed(() => {
        const { start, end } = this.virtual.range();
        return this.resultRows().slice(start, end);
    });

    /** Une page supplémentaire est en cours de lecture. */
    private fetchingRows = false;

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

    public constructor() {
        afterNextRender(() => this.initMonaco());

        // Hauteur réelle d'une ligne, mesurée une fois rendue.
        afterRenderEffect(() => {
            this.visibleRows();
            this.virtual.measure(this.resultsContainerRef()?.nativeElement.querySelector<HTMLElement>("tr.data-row"));
        });

        // Le conteneur des résultats n'existe que lorsqu'un SELECT a répondu : on
        // suit sa taille à chaque fois qu'il apparaît.
        effect(onCleanup => {
            const container = this.resultsContainerRef()?.nativeElement;

            if (!container) {
                return;
            }

            const observer = new ResizeObserver(() => this.virtual.onScroll(container));
            observer.observe(container);
            onCleanup(() => observer.disconnect());
        });

        // Réagir aux changements de thème pour mettre à jour Monaco.
        effect(() => {
            const theme = this.themeService.currentTheme();
            if (this.editor) {
                const monacoTheme = theme === "light" ? "vs" : "vs-dark";
                monaco.editor.setTheme(monacoTheme);
            }
        });

        // Réagir aux changements du mode readOnly pour mettre à jour l'éditeur.
        effect(() => {
            const readOnly = this.dbService.readOnly();
            if (this.editor) {
                this.editor.updateOptions({ readOnly });
            }
        });

        this.destroyRef.onDestroy(() => {
            this.completionDisposable?.dispose();
            this.editor?.dispose();
        });
    }

    /**
     * Retourne le contenu actuel de l'éditeur Monaco.
     */
    private getSql(): string {
        return this.editor?.getValue().trim() ?? "";
    }

    /**
     * Exécute la requête SQL courante.
     * En mode readonly, seules les requêtes SELECT sont autorisées.
     */
    protected async execute(): Promise<void> {
        const sql = this.getSql();
        if (!sql) {
            return;
        }

        // Bloquer les requêtes de mutation en mode readonly
        if (this.dbService.readOnly() && this.isMutationQuery(sql)) {
            this.errorMessage.set(this.i18n.t("sqlEditor.readonlyMutation"));
            return;
        }

        this.isExecuting.set(true);
        this.errorMessage.set(null);
        this.result.set(null);
        this.resultRows.set([]);
        this.virtual.reset(this.resultsContainerRef()?.nativeElement);

        try {
            const response = await this.dbService.execSql(sql);
            this.result.set(response);
            this.resultRows.set(response.rows);
            this.addToHistory(sql);
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err instanceof Error ? err.message : String(err)));
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
        this.resultRows.set([]);
        this.errorMessage.set(null);
    }

    /**
     * Défilement des résultats : met à jour la plage rendue et rapatrie la page
     * suivante à l'approche de la fin des lignes chargées.
     */
    protected onResultsScroll(event: Event): void {
        this.virtual.onScroll(event.target as HTMLElement);

        if (this.virtual.isNearEnd(200)) {
            void this.loadMoreRows();
        }
    }

    /**
     * Rapatrie la page suivante du résultat conservé par le main.
     */
    private async loadMoreRows(): Promise<void> {
        const result = this.result();
        const loaded = this.resultRows().length;

        if (this.fetchingRows || !result?.resultId || loaded >= this.totalResultRows()) {
            return;
        }

        this.fetchingRows = true;

        try {
            const rows = await this.dbService.fetchSqlRows(result.resultId, loaded, RESULT_PAGE_SIZE);

            // La requête a pu être relancée pendant la lecture : cette page
            // appartient alors à un résultat qui n'est plus affiché.
            if (this.result() === result) {
                this.resultRows.update(existing => existing.concat(rows));
            }
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err));
        }
        finally {
            this.fetchingRows = false;
        }
    }

    /**
     * Bascule la visibilité du panneau d'historique.
     */
    protected toggleHistory(): void {
        this.historyVisible.update(v => !v);
    }

    /**
     * Charge une requête depuis l'historique dans l'éditeur.
     */
    protected loadFromHistory(query: string): void {
        if (this.editor) {
            this.editor.setValue(query);
            this.hasInput.set(true);
            this.editor.focus();
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
     * Détecte si une requête SQL est une mutation (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE).
     * Ignore les commentaires et les espaces en début de requête.
     */
    private isMutationQuery(sql: string): boolean {
        const stripped = sql.replace(/^(\s*--[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)*/g, "").trim();
        return /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE)\b/i.test(stripped);
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

    /**
     * Attend que Monaco soit chargé (via le service de préchargement) puis crée l'éditeur.
     */
    private async initMonaco(): Promise<void> {
        const container = this.editorContainerRef()?.nativeElement;
        if (!container) {
            return;
        }

        await this.monacoPreload.whenReady();
        this.createEditor(container);
    }

    /**
     * Crée l'instance Monaco Editor et configure l'autocomplétion DB.
     */
    private createEditor(container: HTMLElement): void {
        // Déterminer le thème en fonction du thème actif
        const theme = this.themeService.currentTheme() === "light" ? "vs" : "vs-dark";

        this.editor = monaco.editor.create(container, {
            value: "",
            language: "sql",
            theme,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            tabSize: 4,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            padding: { top: 8, bottom: 8 },
            readOnly: this.dbService.readOnly(),
        });

        // Ctrl+Enter → exécuter
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            void this.execute();
        });

        // Ctrl+ArrowUp/Down → navigation historique
        // Utilise onKeyDown car addCommand peut être intercepté par Monaco (scrollLineUp/Down)
        this.editor.onKeyDown((e) => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey) {
                if (e.keyCode === monaco.KeyCode.UpArrow) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.navigateHistory(-1);
                } else if (e.keyCode === monaco.KeyCode.DownArrow) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.navigateHistory(1);
                }
            }
        });

        // Mettre à jour hasInput quand le contenu change
        this.editor.onDidChangeModelContent(() => {
            this.hasInput.set((this.editor?.getValue().trim().length ?? 0) > 0);
        });

        this.registerCompletionProvider();
    }

    /**
     * Enregistre un fournisseur d'autocomplétion pour les noms de tables et de colonnes
     * à partir du schéma de la base de données.
     */
    private registerCompletionProvider(): void {
        this.completionDisposable = monaco.languages.registerCompletionItemProvider("sql", {
            provideCompletionItems: (_model, position) => {
                const db = this.state.database();
                if (!db) {
                    return { suggestions: [] };
                }

                const word = _model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };

                const suggestions: import("monaco-editor").languages.CompletionItem[] = [];

                // Ajouter les noms de tables
                for (const table of db.tables) {
                    suggestions.push({
                        label: table.name,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: table.name,
                        detail: `Table (${table.fields.length} columns)`,
                        range,
                    });

                    // Ajouter les colonnes de chaque table
                    for (const field of table.fields) {
                        suggestions.push({
                            label: `${table.name}.${field.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: field.name,
                            detail: `${field.type}${field.pk ? " PK" : ""}${field.fk ? ` FK → ${field.fk.table}` : ""}`,
                            range,
                        });

                        // Aussi fournir le nom de colonne seul
                        suggestions.push({
                            label: field.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: field.name,
                            detail: `${table.name}.${field.name} (${field.type})`,
                            range,
                        });
                    }
                }

                return { suggestions };
            },
        });
    }
}
