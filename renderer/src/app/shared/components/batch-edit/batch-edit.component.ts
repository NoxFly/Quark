/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "src/app/core/services/i18n.service";
import type { FieldDef } from "@shared/types";
import { ButtonComponent } from "@ui/button/button.component";

/**
 * Modal d'édition par lot.
 * Permet de modifier la même valeur sur un champ pour toutes les lignes sélectionnées.
 */
@Component({
    selector: "app-batch-edit",
    standalone: true,
    templateUrl: "./batch-edit.component.html",
    styleUrl: "./batch-edit.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule, ButtonComponent],
})
export class BatchEditComponent implements OnInit {
    protected readonly i18n = inject(I18nService);

    /** Champs éditables (non PK). */
    public readonly fields = input.required<FieldDef[]>();

    /** Nombre de lignes sélectionnées. */
    public readonly rowCount = input.required<number>();

    /** Callback de fermeture du modal. */
    public dismiss?: (data?: { column: string; value: unknown } | null) => void;

    protected readonly selectedColumn = signal<string>("");
    protected readonly inputValue = signal<string>("");
    protected readonly setNull = signal<boolean>(false);

    public ngOnInit(): void {
        const editableFields = this.editableFields();
        const first = editableFields[0];
        if (first) {
            this.selectedColumn.set(first.name);
        }
    }

    protected editableFields(): FieldDef[] {
        return this.fields().filter(f => !f.pk);
    }

    /**
     * Confirme l'édition par lot et ferme le modal.
     */
    protected confirm(): void {
        const column = this.selectedColumn();
        if (!column) {
            return;
        }

        const value = this.setNull() ? null : this.inputValue();
        this.dismiss?.({ column, value });
    }

    /**
     * Annule et ferme le modal.
     */
    protected cancel(): void {
        this.dismiss?.(null);
    }
}
