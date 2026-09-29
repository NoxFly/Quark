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

import { computed, Injectable, inject } from "@angular/core";
import {
    SqlCandidateKind,
    type SqlCompletionAnalysis,
    type SqlCompletionCandidate,
    SqlExpectation,
} from "src/app/core/models/sql-completion.model";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import {
    buildSqlCandidates,
    describeSqlColumn,
    findInlineCompletion,
    indexSqlTables,
} from "src/app/shared/helpers/sql-completion.helper";
import { analyzeSqlContext } from "src/app/shared/helpers/sql-context.helper";
import { resolveSqlDialect } from "src/app/shared/helpers/sql-dialect.helper";

/** Déclarations minimales de Monaco pour éviter d'importer les types globaux. */
declare const monaco: typeof import("monaco-editor");

/** Réglages d'éditeur dont dépend l'autocomplétion. */
const COMPLETION_OPTIONS: import("monaco-editor").editor.IEditorOptions
    & import("monaco-editor").editor.IGlobalEditorOptions = {
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    // Les mots du document noieraient les suggestions contextuelles.
    wordBasedSuggestions: "off",
    // Dans un extrait, la frappe d'un emplacement (`{2:table}`) doit ouvrir la liste des tables.
    suggest: { showWords: false, snippetsPreventQuickSuggestions: false },
    inlineSuggest: { enabled: true, mode: "prefix", showToolbar: "never" },
};

/** `.` appelle les colonnes ; l'espace et la virgule, la suite d'une clause. */
const TRIGGER_CHARACTERS = [".", " ", ","];

/**
 * Attentes pour lesquelles la liste s'ouvre d'elle-même après un espace ou une
 * virgule. Après une table ou une colonne, les mots-clés possibles sont trop
 * nombreux pour ouvrir la liste avant la première lettre.
 */
const OPENS_AFTER_SEPARATOR: ReadonlySet<SqlExpectation> = new Set([
    SqlExpectation.StatementStart,
    SqlExpectation.TableName,
    SqlExpectation.Column,
    SqlExpectation.QualifiedColumn,
    SqlExpectation.ColumnList,
]);

/** Caractère qui prolonge un mot : le curseur est alors au milieu d'un mot. */
const WORD_CHARACTER = /[\p{L}\p{N}_$@#]/u;

/**
 * Autocomplétion SQL des éditeurs Monaco : liste contextuelle (mots-clés du
 * dialecte, tables, colonnes des tables de la requête, fonctions, extraits) et
 * complétion fantôme (suite grisée du mot tapé, acceptée par Tab) quand elle
 * ne fait aucun doute.
 *
 * Les fournisseurs de Monaco sont globaux au langage `sql` : ils ne répondent
 * qu'aux éditeurs rattachés par `attach`, et sont retirés quand le dernier se
 * détache. Le schéma et le dialecte sont ceux de la connexion active.
 */
@Injectable({ providedIn: "root" })
export class SqlCompletionService {
    private readonly state = inject(StateService);
    private readonly i18n = inject(I18nService);

    private readonly dialect = computed(() => resolveSqlDialect(this.state.driverType()));
    private readonly tables = computed(() => indexSqlTables(this.state.database()?.tables ?? []));

    /** URI des modèles des éditeurs rattachés. */
    private readonly models = new Set<string>();

    private providers: import("monaco-editor").IDisposable[] = [];
    private lastAnalysis: SqlCompletionAnalysis | null = null;

    /**
     * @description Active l'autocomplétion SQL sur un éditeur, dont elle ajuste
     * les réglages de suggestion.
     *
     * @param editor - Éditeur Monaco en langage `sql`, déjà créé.
     * @returns À libérer à la destruction de l'éditeur.
     */
    public attach(editor: import("monaco-editor").editor.IStandaloneCodeEditor): import("monaco-editor").IDisposable {
        const model = editor.getModel();

        if (!model) {
            return { dispose: () => undefined };
        }

        const uri = model.uri.toString();
        let attached = true;

        this.registerProviders();
        this.models.add(uri);
        editor.updateOptions(COMPLETION_OPTIONS);

        return {
            dispose: () => {
                if (attached) {
                    attached = false;
                    this.detach(uri);
                }
            },
        };
    }

    /**
     * Détache un modèle ; le dernier retire les fournisseurs.
     */
    private detach(uri: string): void {
        this.models.delete(uri);

        if (this.lastAnalysis?.model.uri.toString() === uri) {
            this.lastAnalysis = null;
        }

        if (this.models.size > 0) {
            return;
        }

        for (const provider of this.providers) {
            provider.dispose();
        }

        this.providers = [];
    }

    /**
     * Enregistre les fournisseurs Monaco, une seule fois.
     */
    private registerProviders(): void {
        if (this.providers.length > 0) {
            return;
        }

        this.providers = [
            monaco.languages.registerCompletionItemProvider("sql", {
                triggerCharacters: TRIGGER_CHARACTERS,
                provideCompletionItems: (model, position, context) => this.provideCompletionItems(model, position, context),
            }),
            monaco.languages.registerInlineCompletionsProvider("sql", {
                provideInlineCompletions: (model, position) => this.provideInlineCompletions(model, position),
                // Les propositions ne retiennent aucune ressource.
                disposeInlineCompletions: () => undefined,
            }),
        ];
    }

    /**
     * Liste de suggestions à la position du curseur.
     */
    private provideCompletionItems(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
        context: import("monaco-editor").languages.CompletionContext,
    ): import("monaco-editor").languages.CompletionList {
        const analysis = this.analyze(model, position);
        const isSeparator = context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter
            && context.triggerCharacter !== ".";

        if (!analysis || (isSeparator && !OPENS_AFTER_SEPARATOR.has(analysis.context.expectation))) {
            return { suggestions: [] };
        }

        const range = this.prefixRange(model, position, analysis);
        const suggestions = analysis.candidates.map((candidate, index) => this.toCompletionItem(candidate, index, range));

        return { suggestions };
    }

    /**
     * Complétion fantôme à la position du curseur.
     */
    private provideInlineCompletions(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
    ): import("monaco-editor").languages.InlineCompletions {
        const analysis = this.analyze(model, position);
        const text = analysis ? findInlineCompletion(analysis.candidates, analysis.context.prefix) : null;

        if (!analysis || text === null || this.isInsideWord(model, position)) {
            return { items: [] };
        }

        return { items: [{ insertText: text, range: this.prefixRange(model, position, analysis) }] };
    }

    /**
     * Analyse la position, ou reprend la dernière analyse si ni le texte, ni le
     * curseur, ni le schéma, ni le dialecte n'ont changé.
     */
    private analyze(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
    ): SqlCompletionAnalysis | null {
        if (!this.models.has(model.uri.toString())) {
            return null;
        }

        const offset = model.getOffsetAt(position);
        const version = model.getVersionId();
        const tables = this.tables();
        const dialect = this.dialect();
        const last = this.lastAnalysis;
        const isUnchanged = last?.model === model
            && last.version === version
            && last.offset === offset
            && last.tables === tables
            && last.dialect === dialect;

        if (last && isUnchanged) {
            return last;
        }

        const context = analyzeSqlContext(model.getValue(), offset);
        const candidates = buildSqlCandidates(context, tables, dialect);

        this.lastAnalysis = { model, version, offset, tables, dialect, context, candidates };

        return this.lastAnalysis;
    }

    /**
     * Plage du mot en cours de frappe, remplacée par la suggestion.
     */
    private prefixRange(
        model: import("monaco-editor").editor.ITextModel,
        position: import("monaco-editor").Position,
        analysis: SqlCompletionAnalysis,
    ): import("monaco-editor").Range {
        const start = model.getPositionAt(analysis.context.prefixStart);

        return new monaco.Range(start.lineNumber, start.column, position.lineNumber, position.column);
    }

    /**
     * Le curseur est suivi d'un caractère de mot : compléter couperait ce mot.
     */
    private isInsideWord(model: import("monaco-editor").editor.ITextModel, position: import("monaco-editor").Position): boolean {
        const next = model.getLineContent(position.lineNumber).charAt(position.column - 1);

        return WORD_CHARACTER.test(next);
    }

    /**
     * Convertit une suggestion en élément de la liste Monaco.
     */
    private toCompletionItem(
        candidate: SqlCompletionCandidate,
        index: number,
        range: import("monaco-editor").IRange,
    ): import("monaco-editor").languages.CompletionItem {
        const item: import("monaco-editor").languages.CompletionItem = {
            label: candidate.label,
            kind: this.completionKind(candidate.kind),
            insertText: candidate.insertText,
            detail: this.describe(candidate),
            // Monaco classe d'abord par correspondance avec la frappe ; l'ordre
            // de pertinence départage ensuite.
            sortText: String(index).padStart(4, "0"),
            range,
        };

        if (candidate.isSnippet) {
            item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
        }

        if (candidate.retrigger) {
            item.command = { id: "editor.action.triggerSuggest", title: "" };
        }

        return item;
    }

    /**
     * Icône Monaco d'une suggestion.
     */
    private completionKind(kind: SqlCandidateKind): import("monaco-editor").languages.CompletionItemKind {
        const kinds = monaco.languages.CompletionItemKind;

        switch (kind) {
            case SqlCandidateKind.Keyword:
                return kinds.Keyword;
            case SqlCandidateKind.Function:
                return kinds.Function;
            case SqlCandidateKind.Table:
                return kinds.Class;
            case SqlCandidateKind.Cte:
                return kinds.Interface;
            case SqlCandidateKind.Alias:
                return kinds.Variable;
            case SqlCandidateKind.Column:
                return kinds.Field;
            case SqlCandidateKind.Star:
                return kinds.Operator;
            case SqlCandidateKind.Snippet:
                return kinds.Snippet;
        }
    }

    /**
     * Détail affiché à droite d'une suggestion.
     */
    private describe(candidate: SqlCompletionCandidate): string | undefined {
        switch (candidate.kind) {
            case SqlCandidateKind.Keyword:
                return this.i18n.t("sqlEditor.completion.keyword");
            case SqlCandidateKind.Function:
                return this.i18n.t("sqlEditor.completion.function");
            case SqlCandidateKind.Table:
                return this.i18n.t("sqlEditor.completion.table", { count: candidate.table?.fields.length ?? 0 });
            case SqlCandidateKind.Cte:
                return this.i18n.t("sqlEditor.completion.cte");
            case SqlCandidateKind.Alias:
                return candidate.owner === null
                    ? this.i18n.t("sqlEditor.completion.derivedAlias")
                    : this.i18n.t("sqlEditor.completion.alias", { table: candidate.owner });
            case SqlCandidateKind.Column:
                return describeSqlColumn(candidate) ?? undefined;
            case SqlCandidateKind.Star:
                return this.i18n.t("sqlEditor.completion.allColumns");
            case SqlCandidateKind.Snippet:
                return candidate.description ?? undefined;
        }
    }
}
