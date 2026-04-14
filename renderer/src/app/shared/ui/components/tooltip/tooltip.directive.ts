/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Directive, inject, input, OnDestroy } from "@angular/core";
import { DOCUMENT } from "@angular/common";

/**
 * Directive tooltip personnalisée.
 * Remplace l'attribut `title` natif du navigateur par un tooltip stylisé.
 *
 * @example
 * ```html
 * <button [tooltip]="'Fermer'">✕</button>
 * ```
 */
@Directive({
    selector: "[tooltip]",
    standalone: true,
    host: {
        "(mouseenter)": "showTooltip($event)",
        "(mouseleave)": "hideTooltip()",
        "(mousedown)": "hideTooltip()",
        "(focus)": "showTooltip($event)",
        "(blur)": "hideTooltip()",
    },
})
export class TooltipDirective implements OnDestroy {
    private readonly document = inject(DOCUMENT);

    /** Texte du tooltip. */
    public readonly tooltip = input<string>("");

    private tooltipEl: HTMLElement | null = null;

    /**
     * Affiche le tooltip sous l'élément hôte.
     */
    protected showTooltip(event: MouseEvent | FocusEvent): void {
        const text = this.tooltip();
        if (!text) {
            return;
        }

        this.tooltipEl = this.document.createElement("div");
        this.tooltipEl.className = "ui-tooltip";
        this.tooltipEl.textContent = text;
        this.document.body.appendChild(this.tooltipEl);

        const target = event.target as HTMLElement;
        this.positionTooltip(target);
    }

    /**
     * Masque et détruit le tooltip.
     */
    protected hideTooltip(): void {
        this.tooltipEl?.remove();
        this.tooltipEl = null;
    }

    /**
     * Positionne le tooltip en dessous de l'élément cible.
     */
    private positionTooltip(target: HTMLElement): void {
        if (!this.tooltipEl) {
            return;
        }

        const rect = target.getBoundingClientRect();

        // Positionnement initial : en-dessous, centré
        requestAnimationFrame(() => {
            if (!this.tooltipEl) {
                return;
            }

            const tw = this.tooltipEl.offsetWidth;
            const th = this.tooltipEl.offsetHeight;

            let x = rect.left + rect.width / 2 - tw / 2;
            let y = rect.bottom + 6;

            // Débordement horizontal
            x = Math.max(4, Math.min(this.document.documentElement.clientWidth - tw - 4, x));

            // Débordement vertical : afficher au-dessus si pas de place en dessous
            if (y + th > this.document.documentElement.clientHeight) {
                y = rect.top - th - 6;
            }

            this.tooltipEl.style.left = `${x}px`;
            this.tooltipEl.style.top = `${y}px`;
        });
    }

    public ngOnDestroy(): void {
        this.hideTooltip();
    }
}
