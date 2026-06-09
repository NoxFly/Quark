/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
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
import { I18nService } from "src/app/core/services/i18n.service";
import { MonacoPreloadService } from "src/app/core/services/monaco-preload.service";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";
import { DatabaseService } from "src/app/core/services/database.service";
import { ThemeService } from "src/app/core/services/theme.service";
import type { StoredProcedureDetail, StoredProcedureExecResult, StoredProcedureParam } from "@shared/types";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";
import { ButtonComponent } from "@ui/button/button.component";
import { InputComponent } from "@ui/input/input.component";
import { extractIpcErrorMessage } from "src/app/shared/helpers/utils";

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

/**
 * Page d'édition et d'exécution des procédures stockées.
 * Affiche un éditeur Monaco avec la définition, un formulaire dynamique
 * pour les paramètres, et les résultats d'exécution.
 */
@Component({
    selector: "app-stored-procedure",
    standalone: true,
    templateUrl: "./stored-procedure.page.html",
    styleUrl: "./stored-procedure.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TooltipDirective, ButtonComponent, InputComponent],
})
export class StoredProcedurePage {
    protected readonly i18n = inject(I18nService);
    protected readonly storedProcService = inject(StoredProceduresService);
    protected readonly dbService = inject(DatabaseService);
    private readonly monacoPreload = inject(MonacoPreloadService);
    private readonly themeService = inject(ThemeService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly editorContainerRef = viewChild<ElementRef<HTMLDivElement>>("monacoContainer");

    protected readonly procedure = signal<StoredProcedureDetail | null>(null);
    protected readonly result = signal<StoredProcedureExecResult | null>(null);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly isExecuting = signal<boolean>(false);
    protected readonly isLoading = signal<boolean>(true);
    protected readonly isSaving = signal<boolean>(false);

    /** Toggle : masquer/afficher la section paramètres. */
    protected readonly paramsVisible = signal<boolean>(true);

    /** Toggle : fullscreen le panneau résultats (masque définition + paramètres). */
    protected readonly resultsFullscreen = signal<boolean>(false);

    /** Indique si c'est une nouvelle procédure (pas encore créée en base). */
    protected readonly isNewProcedure = signal<boolean>(false);

    /** Valeurs du formulaire de paramètres. */
    protected readonly paramValues = signal<Record<string, string>>({});

    /** Paramètres d'entrée (non-output). */
    protected readonly inputParams = computed(() => {
        const proc = this.procedure();
        if (!proc) {
            return [];
        }
        return proc.params.filter(p => !p.isOutput);
    });

    /** Paramètres de sortie. */
    protected readonly outputParams = computed(() => {
        const proc = this.procedure();
        if (!proc) {
            return [];
        }
        return proc.params.filter(p => p.isOutput);
    });

    /** Colonnes du résultat. */
    protected readonly resultColumns = computed(() => this.result()?.columns ?? []);

    /** Lignes du résultat. */
    protected readonly resultRows = computed(() => this.result()?.rows ?? []);

    /** Temps d'exécution formaté. */
    protected readonly executionTime = computed(() => {
        const ms = this.result()?.executionTimeMs;
        if (ms === undefined) {
            return null;
        }
        return ms < 1 ? "< 1 ms" : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
    });

    private editor: import("monaco-editor").editor.IStandaloneCodeEditor | null = null;

    public constructor() {
        // Créer l'éditeur Monaco dès que le conteneur devient disponible dans le DOM.
        effect(() => {
            const container = this.editorContainerRef()?.nativeElement;
            if (!container || this.editor) {
                return;
            }
            void this.initMonaco(container);
        });

        // Réagir aux changements de thème pour mettre à jour Monaco.
        effect(() => {
            const theme = this.themeService.currentTheme();
            if (this.editor) {
                monaco.editor.setTheme(this.resolveMonacoTheme(theme));
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
            this.editor?.dispose();
        });

        // Écouter l'événement de sélection d'une procédure
        const handler = (event: Event): void => {
            const detail = (event as CustomEvent).detail as { name: string; schema: string };
            void this.loadProcedure(detail.name, detail.schema);
        };
        document.addEventListener("open-stored-procedure", handler);
        this.destroyRef.onDestroy(() => document.removeEventListener("open-stored-procedure", handler));

        // Écouter l'événement de création d'une procédure
        const createHandler = (): void => {
            this.createNewProcedure();
        };
        document.addEventListener("create-stored-procedure", createHandler);
        this.destroyRef.onDestroy(() => document.removeEventListener("create-stored-procedure", createHandler));
    }

    /**
     * Charge une procédure stockée dans l'éditeur.
     */
    public async loadProcedure(name: string, schema: string): Promise<void> {
        this.isLoading.set(true);
        this.isNewProcedure.set(false);
        this.result.set(null);
        this.errorMessage.set(null);

        try {
            const detail = await this.storedProcService.loadProcedureDetail(name, schema);
            this.procedure.set(detail);

            // Initialiser les valeurs du formulaire
            const values: Record<string, string> = {};
            for (const param of detail.params) {
                if (!param.isOutput) {
                    values[param.name] = param.hasDefault && param.defaultValue !== null
                        ? String(param.defaultValue)
                        : "";
                }
            }
            this.paramValues.set(values);

            // Mettre à jour l'éditeur Monaco (sans le préfixe CREATE/ALTER)
            if (this.editor) {
                this.editor.setValue(this.stripCreateAlterPrefix(detail.definition));
            }
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err instanceof Error ? err.message : String(err)));
        }
        finally {
            this.isLoading.set(false);
        }
    }

    /**
     * Prépare l'éditeur pour la création d'une nouvelle procédure.
     */
    protected createNewProcedure(): void {
        const template = "PROCEDURE [dbo].[NewProcedure]\nAS\nBEGIN\n    \nEND";
        const detail: StoredProcedureDetail = {
            name: "NewProcedure",
            schema: "dbo",
            definition: template,
            params: [],
            createdAt: null,
            modifiedAt: null,
        };

        this.procedure.set(detail);
        this.isNewProcedure.set(true);
        this.result.set(null);
        this.errorMessage.set(null);
        this.paramValues.set({});
        this.isLoading.set(false);

        if (this.editor) {
            this.editor.setValue(template);
            this.editor.focus();
        }
    }

    /**
     * Exécute la procédure stockée avec les paramètres du formulaire.
     */
    protected async execute(): Promise<void> {
        const proc = this.procedure();
        if (!proc) {
            return;
        }

        this.isExecuting.set(true);
        this.errorMessage.set(null);
        this.result.set(null);

        try {
            const params = this.buildExecParams(proc.params);
            const response = await this.storedProcService.execProcedure(proc.name, proc.schema, params);
            this.result.set(response);
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err instanceof Error ? err.message : String(err)));
        }
        finally {
            this.isExecuting.set(false);
        }
    }

    /**
     * Sauvegarde la procédure stockée. Le backend détermine s'il faut
     * CREATE ou ALTER en fonction de l'existence de la procédure.
     */
    protected async save(): Promise<void> {
        const proc = this.procedure();
        if (!proc || !this.editor) {
            return;
        }

        const definition = this.editor.getValue().trim();
        if (!definition) {
            return;
        }

        this.isSaving.set(true);
        this.errorMessage.set(null);

        try {
            await this.storedProcService.modifyProcedure(proc.name, proc.schema, definition);

            // Après création réussie, recharger la liste et marquer comme existante
            if (this.isNewProcedure()) {
                this.isNewProcedure.set(false);
                await this.storedProcService.loadProcedures();
            }
        }
        catch (err) {
            this.errorMessage.set(extractIpcErrorMessage(err instanceof Error ? err.message : String(err)));
        }
        finally {
            this.isSaving.set(false);
        }
    }

    /**
     * Toggle la visibilité de la section paramètres.
     */
    protected toggleParams(): void {
        this.paramsVisible.update(v => !v);
    }

    /**
     * Toggle le mode fullscreen des résultats.
     */
    protected toggleResultsFullscreen(): void {
        this.resultsFullscreen.update(v => !v);
    }

    /**
     * Met à jour la valeur d'un paramètre.
     */
    protected updateParamValue(paramName: string, value: string): void {
        this.paramValues.update(v => ({ ...v, [paramName]: value }));
    }

    /**
     * Formate la valeur d'une cellule de résultat.
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
     * Retourne la valeur d'un paramètre de sortie après exécution, ou null si non disponible.
     */
    protected getOutputParamValue(paramName: string): unknown {
        const outputParams = this.result()?.outputParams;
        if (!outputParams) {
            return null;
        }
        const value = outputParams[paramName];
        return value !== undefined ? value : null;
    }

    /**
     * Retourne true si la valeur est NULL.
     */
    protected isNull(value: unknown): boolean {
        return value === null || value === undefined;
    }

    /**
     * Démarre le redimensionnement vertical (entre éditeur et résultats).
     */
    protected startVerticalResize(event: MouseEvent): void {
        event.preventDefault();
        const host = (event.target as HTMLElement).closest(".stored-procedure-page") as HTMLElement;
        const editorContainer = host.querySelector(".editor-params-container") as HTMLElement;
        const resultsPanel = host.querySelector(".results-panel") as HTMLElement;
        if (!editorContainer || !resultsPanel) {
            return;
        }

        const startY = event.clientY;
        const startEditorHeight = editorContainer.offsetHeight;
        const totalHeight = editorContainer.offsetHeight + resultsPanel.offsetHeight;

        const onMouseMove = (e: MouseEvent): void => {
            const delta = e.clientY - startY;
            const newEditorHeight = Math.max(100, Math.min(totalHeight - 80, startEditorHeight + delta));
            editorContainer.style.flex = "none";
            editorContainer.style.height = `${newEditorHeight}px`;
            resultsPanel.style.flex = "1";
        };

        const onMouseUp = (): void => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    /**
     * Démarre le redimensionnement horizontal (entre éditeur et paramètres).
     */
    protected startHorizontalResize(event: MouseEvent): void {
        event.preventDefault();
        const host = (event.target as HTMLElement).closest(".editor-params-container") as HTMLElement;
        const paramsSection = host?.querySelector(".params-section") as HTMLElement;
        if (!paramsSection) {
            return;
        }

        const startX = event.clientX;
        const startWidth = paramsSection.offsetWidth;

        const onMouseMove = (e: MouseEvent): void => {
            const delta = startX - e.clientX;
            const newWidth = Math.max(180, Math.min(500, startWidth + delta));
            paramsSection.style.width = `${newWidth}px`;
        };

        const onMouseUp = (): void => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    /**
     * Construit le dictionnaire de paramètres typés pour l'exécution.
     */
    private buildExecParams(paramsDef: StoredProcedureParam[]): Record<string, unknown> {
        const values = this.paramValues();
        const result: Record<string, unknown> = {};

        for (const param of paramsDef) {
            if (param.isOutput) {
                continue;
            }
            const rawValue = values[param.name] ?? "";
            result[param.name] = this.coerceParamValue(rawValue, param.type);
        }

        return result;
    }

    /**
     * Convertit une valeur string du formulaire vers le type approprié.
     */
    private coerceParamValue(value: string, type: string): unknown {
        if (value === "" || value.toLowerCase() === "null") {
            return null;
        }

        const lowerType = type.toLowerCase();

        if (["int", "bigint", "smallint", "tinyint"].includes(lowerType)) {
            const num = Number(value);
            return Number.isNaN(num) ? value : num;
        }

        if (["float", "real", "decimal", "numeric", "money", "smallmoney"].includes(lowerType)) {
            const num = Number(value);
            return Number.isNaN(num) ? value : num;
        }

        if (lowerType === "bit") {
            return value === "1" || value.toLowerCase() === "true";
        }

        return value;
    }

    /**
     * Résout le thème Monaco à partir du thème applicatif.
     */
    private resolveMonacoTheme(appTheme: string): string {
        if (appTheme === "light") {
            return "vs";
        }
        return "vs-dark";
    }

    /**
     * Attend que Monaco soit chargé puis crée l'éditeur.
     */
    private async initMonaco(container: HTMLElement): Promise<void> {
        await this.monacoPreload.whenReady();
        this.createEditor(container);
    }

    /**
     * Retire le préfixe CREATE, ALTER ou CREATE OR ALTER d'une définition
     * de procédure stockée, en ne laissant que la partie commençant par PROCEDURE.
     */
    private stripCreateAlterPrefix(definition: string): string {
        return definition.replace(/^\s*(?:CREATE\s+(?:OR\s+ALTER\s+)?|ALTER\s+)PROC(?:EDURE)?/im, "PROCEDURE");
    }

    /**
     * Crée l'instance Monaco Editor pour la procédure stockée.
     */
    private createEditor(container: HTMLElement): void {
        const theme = this.resolveMonacoTheme(this.themeService.currentTheme());
        const initialDefinition = this.procedure()?.definition ?? "";

        this.editor = monaco.editor.create(container, {
            value: this.stripCreateAlterPrefix(initialDefinition),
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
            padding: { top: 8, bottom: 8 },
            readOnly: this.dbService.readOnly(),
        });

        // Ctrl+S → sauvegarder
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            void this.save();
        });

        // Ctrl+Enter → exécuter
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            void this.execute();
        });
    }
}
