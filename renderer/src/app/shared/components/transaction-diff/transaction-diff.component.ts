/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, computed } from "@angular/core";
import { MutationHistoryService } from "src/app/core/services/mutation-history.service";
import { I18nService } from "src/app/core/services/i18n.service";
import type { MutationRecord } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";

/** Représente une ligne de diff (ajout ou suppression). */
interface DiffLine {
    sign: "+" | "-";
    key: string;
    value: string;
}

/**
 * Modal d'affichage du diff de transaction, dans un style proche de git diff.
 * Montre toutes les mutations effectuées depuis le début de la transaction.
 */
@Component({
    selector: "app-transaction-diff",
    standalone: true,
    templateUrl: "./transaction-diff.component.html",
    styleUrl: "./transaction-diff.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ButtonComponent],
})
export class TransactionDiffComponent {
    private readonly mutationHistory = inject(MutationHistoryService);
    protected readonly i18n = inject(I18nService);

    /** Callback de fermeture. */
    public dismiss?: () => void;

    /** Liste de toutes les mutations de la transaction. */
    protected readonly mutations = computed(() => this.mutationHistory.history());

    /**
     * Retourne le label du type de mutation en majuscules.
     */
    protected getHunkLabel(type: string): string {
        return type.toUpperCase();
    }

    /**
     * Retourne les lignes de diff (+ / -) pour une mutation.
     */
    protected getDiffLines(mutation: MutationRecord): DiffLine[] {
        if (mutation.type === "update" && mutation.column !== undefined) {
            return [
                { sign: "-", key: mutation.column, value: this.formatValue(mutation.oldValue) },
                { sign: "+", key: mutation.column, value: this.formatValue(mutation.newValue) },
            ];
        }

        if (mutation.type === "insert" && mutation.newValue !== null && mutation.newValue !== undefined) {
            return Object.entries(mutation.newValue as Record<string, unknown>)
                .filter(([key]) => key !== "rowid")
                .map(([key, value]) => ({ sign: "+", key, value: this.formatValue(value) }) satisfies DiffLine);
        }

        if (mutation.type === "delete" && mutation.oldRecord) {
            return Object.entries(mutation.oldRecord)
                .filter(([key]) => key !== "rowid")
                .map(([key, value]) => ({ sign: "-", key, value: this.formatValue(value) }) satisfies DiffLine);
        }

        return [];
    }

    /**
     * Formate une valeur pour l'affichage dans le diff.
     */
    protected formatValue(value: unknown): string {
        if (value === null || value === undefined) {
            return "NULL";
        }
        if (typeof value === "string") {
            return `"${value}"`;
        }
        return String(value);
    }

    protected close(): void {
        this.dismiss?.();
    }
}
