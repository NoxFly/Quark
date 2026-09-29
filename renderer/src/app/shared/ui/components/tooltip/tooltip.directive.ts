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

import { DOCUMENT } from "@angular/common";
import { Directive, effect, ElementRef, inject, input, OnDestroy, untracked } from "@angular/core";
import { computeTooltipPosition, type TooltipOwner, TooltipSlot } from "src/app/shared/ui/components/tooltip/tooltip.helper";

/** Un seul tooltip visible à la fois, toutes directives confondues. */
const TOOLTIP_SLOT = new TooltipSlot();

/** Délai d'apparition par défaut : évite les tooltips qui clignotent au simple passage. */
const DEFAULT_SHOW_DELAY_MS = 350;

/**
 * Intervalle de vérification de l'hôte pendant l'attente et l'affichage.
 * Filet de sécurité pour les cas sans événement de sortie : hôte retiré du DOM
 * ou remplacé sous le pointeur, pointeur capturé par un autre élément.
 */
const WATCHDOG_INTERVAL_MS = 250;

/**
 * Directive tooltip personnalisée.
 * Remplace l'attribut `title` natif du navigateur par un tooltip stylisé.
 *
 * Le tooltip disparaît dès que l'hôte n'est plus survolé ni focalisé au clavier,
 * au clic, au défilement, à la perte de focus de la fenêtre, quand son texte
 * change, quand l'hôte est détruit ou retiré du DOM, et quand un autre tooltip
 * s'affiche.
 *
 * @example
 * ```html
 * <button [tooltip]="'Fermer'">Fermer</button>
 * ```
 */
@Directive({
    selector: "[tooltip]",
    standalone: true,
    host: {
        "(pointerenter)": "onPointerEnter()",
        "(pointerleave)": "onLeave()",
        "(mouseleave)": "onLeave()",
        "(pointerdown)": "onPress()",
        "(click)": "onPress()",
        "(focusin)": "onFocusIn()",
        "(focusout)": "onLeave()",
        "(keydown.escape)": "hide()",
    },
})
export class TooltipDirective implements OnDestroy, TooltipOwner {
    private readonly document = inject(DOCUMENT);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    /** Texte du tooltip. */
    public readonly tooltip = input<string>("");

    /** Délai avant apparition, en millisecondes. */
    public readonly tooltipDelay = input<number>(DEFAULT_SHOW_DELAY_MS);

    private tooltipEl: HTMLElement | null = null;
    private showTimer: ReturnType<typeof setTimeout> | null = null;
    private watchdog: ReturnType<typeof setInterval> | null = null;
    private positionFrame: number | null = null;

    /**
     * Après un clic, le tooltip ne revient pas tant que le pointeur n'a pas
     * quitté l'hôte : sinon le focus posé par le clic le réafficherait aussitôt.
     */
    private suppressed = false;

    /** Écouteur global, posé seulement pendant l'attente ou l'affichage. */
    private readonly onGlobalDismiss = (): void => this.hide();

    private readonly onVisibilityChange = (): void => {
        if (this.document.visibilityState === "hidden") {
            this.hide();
        }
    };

    public constructor() {
        // Texte modifié pendant l'affichage (bouton bascule, libellé recalculé) :
        // l'ancien texte serait faux, on le retire.
        effect(() => {
            this.tooltip();
            untracked(() => this.hide());
        });
    }

    public ngOnDestroy(): void {
        this.hide();
    }

    /**
     * @description Masque le tooltip et annule un affichage en attente.
     */
    public hide(): void {
        this.cancelShow();
        this.stopWatching();

        if (this.positionFrame !== null) {
            cancelAnimationFrame(this.positionFrame);
            this.positionFrame = null;
        }

        this.tooltipEl?.remove();
        this.tooltipEl = null;
        TOOLTIP_SLOT.release(this);
    }

    protected onPointerEnter(): void {
        if (!this.suppressed) {
            this.scheduleShow();
        }
    }

    protected onLeave(): void {
        this.suppressed = false;
        this.hide();
    }

    protected onPress(): void {
        this.suppressed = true;
        this.hide();
    }

    /**
     * Focus clavier uniquement : un focus posé par la souris est déjà couvert
     * par le survol, et ne doit pas contourner la suppression après un clic.
     */
    protected onFocusIn(): void {
        if (!this.suppressed && this.isFocusVisible()) {
            this.scheduleShow();
        }
    }

    private scheduleShow(): void {
        if (!this.tooltip() || this.tooltipEl || this.showTimer !== null) {
            return;
        }

        this.startWatching();
        this.showTimer = setTimeout(() => {
            this.showTimer = null;
            this.show();
        }, Math.max(0, this.tooltipDelay()));
    }

    private cancelShow(): void {
        if (this.showTimer !== null) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
    }

    private show(): void {
        const text = this.tooltip();
        const host = this.host.nativeElement;

        if (!text || !this.isHostActive()) {
            this.hide();
            return;
        }

        TOOLTIP_SLOT.claim(this);

        const el = this.document.createElement("div");
        el.className = "ui-tooltip";
        el.setAttribute("role", "tooltip");
        el.textContent = text;
        this.document.body.appendChild(el);
        this.tooltipEl = el;

        // Mesure après insertion : la largeur dépend du texte et de la police.
        this.positionFrame = requestAnimationFrame(() => {
            this.positionFrame = null;

            if (this.tooltipEl !== el) {
                return;
            }

            const viewport = this.document.documentElement;
            const { x, y } = computeTooltipPosition(
                host.getBoundingClientRect(),
                { width: el.offsetWidth, height: el.offsetHeight },
                { width: viewport.clientWidth, height: viewport.clientHeight },
            );

            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        });
    }

    /**
     * L'hôte est toujours dans le DOM, et toujours survolé ou focalisé au clavier.
     */
    private isHostActive(): boolean {
        const host = this.host.nativeElement;

        if (!host.isConnected) {
            return false;
        }

        return host.matches(":hover") || this.isFocusVisible();
    }

    private isFocusVisible(): boolean {
        const active = this.document.activeElement;

        if (!(active instanceof HTMLElement) || !this.host.nativeElement.contains(active)) {
            return false;
        }

        return active.matches(":focus-visible");
    }

    private startWatching(): void {
        const view = this.document.defaultView;

        if (this.watchdog !== null || !view) {
            return;
        }

        // Capture : le défilement d'un conteneur interne ne remonte pas jusqu'à window.
        view.addEventListener("scroll", this.onGlobalDismiss, true);
        view.addEventListener("wheel", this.onGlobalDismiss, { capture: true, passive: true });
        view.addEventListener("blur", this.onGlobalDismiss);
        view.addEventListener("resize", this.onGlobalDismiss);
        this.document.addEventListener("visibilitychange", this.onVisibilityChange);

        this.watchdog = setInterval(() => {
            const host = this.host.nativeElement;

            // Pendant l'attente, seul le retrait du DOM compte : `:hover` peut
            // être en retard d'une frame juste après l'entrée du pointeur.
            if (!host.isConnected || (this.tooltipEl && !this.isHostActive())) {
                this.hide();
            }
        }, WATCHDOG_INTERVAL_MS);
    }

    private stopWatching(): void {
        if (this.watchdog === null) {
            return;
        }

        clearInterval(this.watchdog);
        this.watchdog = null;

        const view = this.document.defaultView;
        view?.removeEventListener("scroll", this.onGlobalDismiss, true);
        view?.removeEventListener("wheel", this.onGlobalDismiss, true);
        view?.removeEventListener("blur", this.onGlobalDismiss);
        view?.removeEventListener("resize", this.onGlobalDismiss);
        this.document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
}
