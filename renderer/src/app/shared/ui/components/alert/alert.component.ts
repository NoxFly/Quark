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

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { UIComponent } from "src/app/shared/ui/UIComponent.directive";
import type { ExtendedUIColor, UIAction, UIColor } from "src/app/shared/ui/ui.types";
import { ButtonComponent } from "../button/button.component";
import { BypassPipe } from "src/app/shared/pipes/bypass.pipe";

@Component({
    selector: "ui-alert",
    standalone: true,
    templateUrl: "./alert.component.html",
    styleUrls: ["./alert.component.scss"],
    imports: [ButtonComponent, BypassPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.details-opened]": "detailsOpened()",
        "[attr.data-color]": "color() ?? null",
        "(document:keyup.escape)": "onEscape()",
    }
})
export class AlertComponent extends UIComponent {
    protected readonly i18n = inject(I18nService);

    protected readonly defaultActions: UIAction[] = [
        { text: "Ok", role: "cancel", handler: (_self, action) => this.dismiss({ role: action.role }) },
    ];

    public readonly title = input<string>();
    public readonly message = input<string>();
    public readonly actions = input<UIAction[]>(this.defaultActions);
    public readonly details = input<string>("");
    public readonly color = input<UIColor | null>(null);

    protected readonly detailsOpened = signal<boolean>(false);
    protected readonly hasActions = computed(() => this.actions().length > 0);
    protected readonly hasDetails = computed(() => this.details().length > 0);

    /** Pastille de la maquette : « ! » pour une alerte d'erreur ou d'avertissement, « i » sinon. */
    protected readonly badge = computed<string>(() => {
        const color = this.color();
        if (color === "danger" || color === "warning") {
            return "!";
        }
        if (color === "success") {
            return "✓";
        }
        return "i";
    });

    protected readonly formattedDetails = computed(() => {
        const raw = this.details();

        if (!raw) {
            return "<pre></pre>";
        }

        const parts: string[] = [];
        let i = 0;

        while (i < raw.length) {
            if (raw[i] === "{" || raw[i] === "[") {
                const jsonEnd = this.findJsonEnd(raw, i);

                if (jsonEnd > i) {
                    const candidate = raw.substring(i, jsonEnd);

                    try {
                        const parsed = JSON.parse(candidate);
                        const beautified = JSON.stringify(parsed, null, 4);
                        parts.push(`</pre><code><pre class="code-pre">${beautified}</pre></code><pre>`);
                        i = jsonEnd;
                        continue;
                    }
                    catch {
                        // JSON invalide - on laisse le texte tel quel
                    }
                }
            }

            parts.push(raw.charAt(i));
            i++;
        }

        return `<pre>${parts.join("")}</pre>`;
    });

    /**
     * Parcourt la chaîne à partir de `start` pour trouver la fin d'un bloc JSON
     * potentiel en traquant la profondeur des accolades et crochets,
     * tout en ignorant ceux qui apparaissent dans des chaînes JSON.
     * @param text Le texte à analyser.
     * @param start L'index de départ (doit pointer sur `{` ou `[`).
     * @returns L'index juste après le crochet/accolade fermant, ou `start` si aucun bloc valide n'est trouvé.
     */
    private findJsonEnd(text: string, start: number): number {
        let depth = 0;
        let inString = false;
        let j = start;

        while (j < text.length) {
            const c = text[j];

            if (inString) {
                if (c === "\\") {
                    j++; // saute le caractère échappé
                }
                else if (c === "\"") {
                    inString = false;
                }
            }
            else {
                if (c === "\"") {
                    inString = true;
                }
                else if (c === "{" || c === "[") {
                    depth++;
                }
                else if (c === "}" || c === "]") {
                    depth--;

                    if (depth === 0) {
                        return j + 1;
                    }
                }
            }

            j++;
        }

        return start;
    }

    /**
     *
     */
    protected getPrettyMessage(): string {
        const msg = this.message();

        if (!msg) {
            return "";
        }

        return msg
            .split("\n")
            .filter(Boolean)
            .map((line) => `<p>${line.trim()}</p>`)
            .join("");
    }

    /**
     *
     */
    protected toggleDetails(): void {
        this.detailsOpened.update((prev) => !prev);
    }

    /**
     * Couleur du bouton d'une action : celle qu'elle impose, sinon celle de son rôle.
     * Les variantes en dégradé, abandonnées par la maquette, retombent sur leur couleur pleine.
     */
    protected actionColor(action: UIAction): ExtendedUIColor {
        const color = action.color ?? this.getButtonRoleClass(action);
        return color.endsWith("-gradient") ? color.replace("-gradient", "") as ExtendedUIColor : color;
    }

    /**
     * Échap ferme l'alerte. Écouté par l'hôte plutôt que par un `addEventListener`
     * sur le document, qui n'était jamais retiré et survivait à l'alerte.
     */
    protected onEscape(): void {
        if (!this.disappearing()) {
            this.dismiss({ role: "cancel" });
        }
    }
}
