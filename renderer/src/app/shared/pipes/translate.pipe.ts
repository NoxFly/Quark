/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { inject, Pipe, PipeTransform } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";

/**
 * Pipe de traduction.
 * Impure pour réagir aux changements de locale sans nécessiter
 * de ré-évaluation explicite dans les composants OnPush.
 *
 * @example
 * {{ "menu.file" | translate }}
 * {{ "statusbar.rows" | translate:{ loaded: 10, total: 100 } }}
 */
@Pipe({
    name: "translate",
    standalone: true,
    pure: false,
})
export class TranslatePipe implements PipeTransform {
    private readonly i18n = inject(I18nService);

    /**
     * Traduit une clé avec des paramètres optionnels.
     */
    public transform(key: string, params?: Record<string, string | number>): string {
        return this.i18n.t(key, params);
    }
}
