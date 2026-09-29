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
    DOCUMENT,
    effect,
    ElementRef,
    inject,
    signal,
    viewChild,
} from "@angular/core";
import type { R_SqlExecResponse } from "@shared/types";
import type { SqlHistoryEntry, SqlHistoryItemView } from "src/app/core/models/sql-history.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { SqlHistoryService } from "src/app/core/services/sql-history.service";
import { StateService } from "src/app/core/services/state.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { compactQuery, formatExecutionTime } from "src/app/shared/helpers/sql-history.helper";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";
import { VirtualRows } from "src/app/shared/helpers/virtual-rows.helper";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { ButtonComponent } from "@ui/button/button.component";

/** Lignes demandées au main à chaque page supplémentaire. */
const RESULT_PAGE_SIZE = 1000;

/** Hauteur de ligne attendue (voir la feuille de style), avant mesure. */
const ESTIMATED_ROW_HEIGHT = 32;

/** Bornes de la hauteur automatique de l'éditeur, qui suit son contenu. */
const EDITOR_MIN_HEIGHT = 100;
const EDITOR_MAX_HEIGHT = 280;

/** Hauteur minimale laissée aux résultats quand l'éditeur est agrandi à la main. */
const RESULTS_MIN_HEIGHT = 80;

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

/**
 * Page d'éditeur SQL avec Monaco Editor.
 * Permet d'exécuter des requêtes SQL arbitraires sur la base de données.
 * Raccourci : Ctrl+Shift+Q
 *
 * L'éditeur Monaco est chargé dynamiquement via un script AMD loader
 * pré-configuré depuis les assets Angular (`/vs/`). Son thème est dérivé des
 * design tokens (`--syntax-*`) par `MonacoPreloadService`.
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
    protected readonly history = inject(SqlHistoryService);
    private readonly state = inject(StateService);
    private readonly monacoPreload = inject(MonacoPreloadService);
    private readonly themeService = inject(ThemeService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly document = inject(DOCUMENT);

    private readonly editorContainerRef = viewChild<ElementRef<HTMLDivElement>>("monacoContainer");
    private readonly editorMainRef = viewChild<ElementRef<HTMLDivElement>>("editorMain");
    private readonly resultsContainerRef = viewChild<ElementRef<HTMLDivElement>>("resultsContainer");

    protected readonly result = signal<R_SqlExecResponse | null>(null);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly isExecuting = signal<boolean>(false);
    protected readonly hasInput = signal<boolean>(false);

    /** La poignée entre l'éditeur et les résultats est en cours de glissement. */
    protected readonly isResizingEditor = signal<boolean>(false);

    /** Retire les écouteurs d'un glissement de la poignée resté en cours. */
    private stopEditorResize: (() => void) | null = null;

    /** Position dans l'historique lors de la navigation Ctrl+↑/↓ (-1 : hors historique). */
    private historyIndex = -1;

    /** Indique si le panneau d'historique est visible. */
    protected readonly historyVisible = signal<boolean>(false);

    private editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;
    private completionDisposable: import("monaco-editor").IDisposable | null = null;

    /**
     * L'utilisateur a redimensionné l'éditeur à la main : sa hauteur ne suit plus
     * le contenu, qui l'écraserait à chaque frappe.
     */
    private manualEditorHeight = false;

    /** Dernière hauteur appliquée automatiquement. */
    private autoEditorHeight = 0;

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

    /** Statut affiché à droite de la barre d'outils : « Prêt », « 23 lignes · 6 ms », erreur. */
    protected readonly statusText = computed(() => {
        if (this.isExecuting()) {
            return this.i18n.t("sqlEditor.executing");
        }

        const error = this.errorMessage();

        if (error) {
            return error;
        }

        const result = this.result();

        if (!result) {
            return this.i18n.t("sqlEditor.ready");
        }

        return this.describeResult(result.isSelect, this.totalResultRows(), result.rowsAffected, result.executionTimeMs);
    });

    /** Historique prêt à l'affichage. */
    protected readonly historyItems = computed<SqlHistoryItemView[]>(() => this.history.entries().map(entry => ({
        entry,
        compactQuery: compactQuery(entry.query),
        time: this.i18n.formatDate(entry.executedAt, { hour: "2-digit", minute: "2-digit" }),
        result: this.describeHistoryEntry(entry),
    })));

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

        // Les couleurs de Monaco sont figées dans son thème : on le redéfinit à
        // chaque changement de thème de l'application.
        effect(() => {
            this.themeService.currentTheme();

            if (this.editor) {
                this.monacoPreload.applyAppTheme();
            }
        });

        // Réagir aux changements du mode readOnly (et de langue, pour le message
        // affiché à la saisie en lecture seule) pour mettre à jour l'éditeur.
        effect(() => {
            const readOnly = this.dbService.readOnly();
            const readOnlyMessage = { value: this.i18n.t("sqlEditor.readOnlyMessage") };

            if (this.editor) {
                this.editor.updateOptions({ readOnly, readOnlyMessage });
            }
        });

        this.destroyRef.onDestroy(() => {
            this.stopEditorResize?.();
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
     * Exécute la requête SQL courante et l'inscrit dans l'historique, qu'elle
     * aboutisse ou non. En mode readonly, seules les requêtes SELECT sont autorisées.
     */
    protected async execute(): Promise<void> {
        const sql = this.getSql();
        if (!sql || this.isExecuting()) {
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
            const rows = response.isSelect ? response.totalRows ?? response.rows.length : response.rowsAffected;

            this.result.set(response);
            this.resultRows.set(response.rows);
            this.recordHistory({
                query: sql,
                executedAt: Date.now(),
                status: "ok",
                isSelect: response.isSelect,
                rows,
                durationMs: response.executionTimeMs,
                error: null,
            });
        }
        catch (err) {
            const message = extractIpcErrorMessage(err instanceof Error ? err.message : String(err));

            this.errorMessage.set(message);
            this.recordHistory({
                query: sql,
                executedAt: Date.now(),
                status: "error",
                isSelect: false,
                rows: 0,
                durationMs: null,
                error: message,
            });
        }
        finally {
            this.isExecuting.set(false);
        }
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
     * Glissement de la poignée placée entre l'éditeur et les résultats : la
     * hauteur de l'éditeur est fixée à la main, bornée pour laisser de la place
     * aux résultats, et ne suit plus son contenu.
     */
    protected startEditorResize(event: MouseEvent): void {
        const container = this.editorContainerRef()?.nativeElement;
        const main = this.editorMainRef()?.nativeElement;

        if (event.button !== 0 || !container || !main) {
            return;
        }

        event.preventDefault();
        this.stopEditorResize?.();
        this.isResizingEditor.set(true);

        const startY = event.clientY;
        const startHeight = container.offsetHeight;
        const maxHeight = Math.max(EDITOR_MIN_HEIGHT, main.clientHeight - RESULTS_MIN_HEIGHT);
        const root = this.document.documentElement;

        // Le curseur reste celui de la poignée même quand la souris la quitte.
        root.style.cursor = "row-resize";

        const onMouseMove = (e: MouseEvent): void => {
            const height = Math.round(Math.min(maxHeight, Math.max(EDITOR_MIN_HEIGHT, startHeight + e.clientY - startY)));

            this.manualEditorHeight = true;
            container.style.height = `${height}px`;
        };

        const stop = (): void => {
            this.isResizingEditor.set(false);
            root.style.cursor = "";
            this.document.removeEventListener("mousemove", onMouseMove);
            this.document.removeEventListener("mouseup", stop);
            this.stopEditorResize = null;
        };

        this.stopEditorResize = stop;
        this.document.addEventListener("mousemove", onMouseMove);
        this.document.addEventListener("mouseup", stop);
    }

    /**
     * Double-clic sur la poignée : l'éditeur reprend la hauteur de son contenu.
     */
    protected resetEditorHeight(): void {
        const container = this.editorContainerRef()?.nativeElement;

        this.manualEditorHeight = false;
        this.autoEditorHeight = 0;

        if (container) {
            this.fitEditorHeight(container);
        }
    }

    /**
     * Bascule la visibilité du panneau d'historique.
     */
    protected toggleHistory(): void {
        this.historyVisible.update(v => !v);
    }

    /**
     * Vide l'historique de la base courante.
     */
    protected clearHistory(): void {
        this.history.clear();
        this.historyIndex = -1;
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
     * Les colonnes d'un résultat n'ont pas de type déclaré : seul le texte garde
     * la police de l'interface, le reste (nombres, NULL, JSON) est en chasse fixe.
     */
    protected isMonoCell(value: unknown): boolean {
        return typeof value !== "string";
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
     * Libellé du résultat d'une exécution : « 23 lignes · 6 ms » ou « 1 ligne(s) affectée(s) · 2 ms ».
     */
    private describeResult(isSelect: boolean, rows: number, rowsAffected: number, durationMs: number | null): string {
        const count = isSelect
            ? this.i18n.t("sqlEditor.rowCount", { count: this.i18n.formatNumber(rows) })
            : this.i18n.t("sqlEditor.rowsAffected", { count: this.i18n.formatNumber(rowsAffected) });

        if (durationMs === null) {
            return count;
        }

        const duration = formatExecutionTime(durationMs);

        return `${count} · ${duration}`;
    }

    /**
     * Libellé du résultat d'une entrée de l'historique : son message d'erreur, ou son résultat.
     */
    private describeHistoryEntry(entry: SqlHistoryEntry): string {
        if (entry.status === "error") {
            return entry.error ?? "";
        }

        return this.describeResult(entry.isSelect, entry.rows, entry.rows, entry.durationMs);
    }

    /**
     * Ajoute une exécution à l'historique et sort de la navigation Ctrl+↑/↓.
     */
    private recordHistory(entry: SqlHistoryEntry): void {
        this.history.add(entry);
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
        const history = this.history.entries();
        if (history.length === 0) {
            return;
        }

        this.historyIndex = Math.max(-1, Math.min(history.length - 1, this.historyIndex + delta));

        if (this.historyIndex >= 0) {
            const entry = history[this.historyIndex];
            if (entry !== undefined) {
                this.loadFromHistory(entry.query);
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
     * Ajuste la hauteur de l'éditeur à son contenu, entre ses deux bornes, tant
     * que l'utilisateur ne l'a pas fixée lui-même.
     */
    private fitEditorHeight(container: HTMLElement): void {
        if (!this.editor || this.manualEditorHeight) {
            return;
        }

        const contentHeight = this.editor.getContentHeight();
        const height = Math.round(Math.min(EDITOR_MAX_HEIGHT, Math.max(EDITOR_MIN_HEIGHT, contentHeight)));

        if (height !== this.autoEditorHeight) {
            this.autoEditorHeight = height;
            container.style.height = `${height}px`;
        }
    }

    /**
     * Crée l'instance Monaco Editor et configure l'autocomplétion DB.
     */
    private createEditor(container: HTMLElement): void {
        const theme = this.monacoPreload.applyAppTheme();

        // Fira Code 12,5 px, interligne 1,6 : la grammaire de la maquette.
        this.editor = monaco.editor.create(container, {
            value: "",
            language: "sql",
            theme,
            minimap: { enabled: false },
            fontSize: 12.5,
            lineHeight: 20,
            fontFamily: "'Fira Code', ui-monospace, Consolas, monospace",
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 10,
            glyphMargin: false,
            folding: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            tabSize: 4,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            padding: { top: 12, bottom: 12 },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            readOnly: this.dbService.readOnly(),
            readOnlyMessage: { value: this.i18n.t("sqlEditor.readOnlyMessage") },
            // Le conteneur rogne ce qui dépasse (overflow: hidden) : le message
            // de lecture seule, les suggestions et les survols, qui s'affichent
            // au-dessus de la première ligne ou sous la dernière, sortent donc
            // de l'éditeur en position fixe pour rester entiers.
            fixedOverflowWidgets: true,
        });

        this.fitEditorHeight(container);
        this.editor.onDidContentSizeChange(() => this.fitEditorHeight(container));

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
                }
                else if (e.keyCode === monaco.KeyCode.DownArrow) {
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
