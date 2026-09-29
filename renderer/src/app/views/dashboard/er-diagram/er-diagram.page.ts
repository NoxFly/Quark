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
import type { FieldDef } from "@shared/types";
import type {
    ErFkLink,
    ErNodeDrag,
    ErTableNode,
    ErViewPan,
    ErViewport,
} from "src/app/core/models/er-diagram.model";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import {
    computeErLinks,
    ER_GRID_STEP,
    ER_HEADER_HEIGHT,
    ER_ROW_HEIGHT,
    layoutErNodes,
    zoomViewAt,
} from "src/app/shared/helpers/er-diagram.helper";

/** Vue initiale : léger retrait pour ne pas coller les premières boîtes au bord. */
const INITIAL_VIEW: ErViewport = { x: 20, y: 20, k: 1 };

/** Facteur appliqué par cran de molette ou clic sur − / +. */
const ZOOM_FACTOR = 1.1;

/** Déplacement (px) au-delà duquel un appui sur une boîte devient un glisser et non un clic. */
const CLICK_TOLERANCE = 3;

/** Marge laissée autour du contenu dans le calque SVG des liens. */
const CANVAS_PADDING = 200;

/**
 * Page de diagramme entité-relation (ER Diagram).
 *
 * Affiche les tables de la base et leurs clés étrangères sur un plan infini :
 * molette pour zoomer (centré sur le pointeur), glisser le fond pour déplacer la
 * vue, glisser une boîte pour la repositionner, clic sur son en-tête pour ouvrir
 * la table.
 */
@Component({
    selector: "app-er-diagram",
    standalone: true,
    templateUrl: "./er-diagram.page.html",
    styleUrl: "./er-diagram.page.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErDiagramPage {
    protected readonly i18n = inject(I18nService);
    private readonly state = inject(StateService);
    private readonly dbService = inject(DatabaseService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly canvasRef = viewChild<ElementRef<HTMLDivElement>>("erCanvas");

    protected readonly headerHeight = ER_HEADER_HEIGHT;
    protected readonly rowHeight = ER_ROW_HEIGHT;

    /** Positions modifiables des boîtes. */
    protected readonly nodes = signal<ErTableNode[]>([]);

    /** Translation et zoom de la vue. */
    protected readonly view = signal<ErViewport>(INITIAL_VIEW);

    /** Un déplacement de la vue ou d'une boîte est en cours (curseur « main fermée »). */
    protected readonly panning = signal<boolean>(false);

    /** Liens FK recalculés quand les boîtes bougent. */
    protected readonly links = computed<ErFkLink[]>(() => computeErLinks(this.nodes()));

    /** Étendue du calque SVG des liens, en coordonnées du plan. */
    protected readonly canvasSize = computed(() => {
        const nodes = this.nodes();

        if (nodes.length === 0) {
            return { width: 600, height: 400 };
        }

        const width = Math.max(...nodes.map(node => node.x + node.width)) + CANVAS_PADDING;
        const height = Math.max(...nodes.map(node => node.y + node.height)) + CANVAS_PADDING;

        return { width, height };
    });

    protected readonly layerTransform = computed(() => {
        const { x, y, k } = this.view();
        return `translate(${x}px, ${y}px) scale(${k})`;
    });

    /** La grille de points suit la vue : même pas mis à l'échelle, même décalage. */
    protected readonly gridSize = computed(() => {
        const step = ER_GRID_STEP * this.view().k;
        return `${step}px ${step}px`;
    });

    protected readonly gridPosition = computed(() => {
        const { x, y } = this.view();
        return `${x}px ${y}px`;
    });

    /** Libellé du zoom, « 100 % ». */
    protected readonly zoomLabel = computed(() => {
        const percent = this.i18n.formatNumber(this.view().k, { style: "percent", maximumFractionDigits: 0 });
        return percent;
    });

    private nodeDrag: ErNodeDrag | null = null;
    private viewPan: ErViewPan | null = null;

    public constructor() {
        effect(() => {
            const db = this.state.database();
            this.nodes.set(db ? layoutErNodes(db.tables) : []);
        });

        this.destroyRef.onDestroy(() => this.detachDocumentListeners());
    }

    /**
     * Pastille de clé d'une colonne (PK, FK), vide sinon.
     */
    protected fieldKey(field: FieldDef): "PK" | "FK" | "" {
        if (field.pk) {
            return "PK";
        }

        if (field.fk) {
            return "FK";
        }

        return "";
    }

    /**
     * Nombre de lignes d'une table, formaté pour la langue courante.
     */
    protected formatRowCount(count: number): string {
        return this.i18n.formatNumber(count);
    }

    /**
     * Molette : zoom centré sur le pointeur.
     */
    protected onWheel(event: WheelEvent): void {
        event.preventDefault();

        const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const origin = this.pointerInCanvas(event);

        this.view.update(view => zoomViewAt(view, factor, origin.x, origin.y));
    }

    /**
     * Appui sur le fond : début du déplacement de la vue.
     */
    protected startPan(event: MouseEvent): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();

        const view = this.view();
        this.viewPan = { startMouseX: event.clientX, startMouseY: event.clientY, startX: view.x, startY: view.y };
        this.panning.set(true);
        this.attachDocumentListeners();
    }

    /**
     * Appui sur une boîte : début de son déplacement, ou clic sur l'en-tête.
     */
    protected startNodeDrag(event: MouseEvent, index: number): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const node = this.nodes()[index];

        if (!node) {
            return;
        }

        const onHeader = (event.target as Element).closest(".box-header") !== null;

        this.nodeDrag = {
            index,
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            startNodeX: node.x,
            startNodeY: node.y,
            moved: false,
            onHeader,
        };
        this.attachDocumentListeners();
    }

    /**
     * Zoom par les boutons − / +, centré sur le milieu du cadre.
     */
    protected zoomBy(factor: number): void {
        const canvas = this.canvasRef()?.nativeElement;
        const centerX = (canvas?.clientWidth ?? 0) / 2;
        const centerY = (canvas?.clientHeight ?? 0) / 2;

        this.view.update(view => zoomViewAt(view, factor, centerX, centerY));
    }

    protected zoomIn(): void {
        this.zoomBy(ZOOM_FACTOR);
    }

    protected zoomOut(): void {
        this.zoomBy(1 / ZOOM_FACTOR);
    }

    /**
     * Revient à la vue initiale (zoom 100 %, sans décalage).
     */
    protected resetView(): void {
        this.view.set(INITIAL_VIEW);
    }

    /** Position du pointeur relativement au cadre du diagramme. */
    private pointerInCanvas(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvasRef()?.nativeElement.getBoundingClientRect();

        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    }

    private readonly onMouseMove = (event: MouseEvent): void => {
        const drag = this.nodeDrag;

        if (drag) {
            const dx = event.clientX - drag.startMouseX;
            const dy = event.clientY - drag.startMouseY;

            if (!drag.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) {
                return;
            }

            if (!drag.moved) {
                drag.moved = true;
                this.panning.set(true);
            }

            const k = this.view().k;
            const x = drag.startNodeX + dx / k;
            const y = drag.startNodeY + dy / k;

            this.nodes.update(nodes => nodes.map((node, i) => i === drag.index ? { ...node, x, y } : node));
            return;
        }

        const pan = this.viewPan;

        if (pan) {
            const x = pan.startX + event.clientX - pan.startMouseX;
            const y = pan.startY + event.clientY - pan.startMouseY;

            this.view.update(view => ({ ...view, x, y }));
        }
    };

    private readonly onMouseUp = (): void => {
        const drag = this.nodeDrag;

        this.nodeDrag = null;
        this.viewPan = null;
        this.panning.set(false);
        this.detachDocumentListeners();

        if (drag && !drag.moved && drag.onHeader) {
            const table = this.nodes()[drag.index]?.table.name;

            if (table) {
                void this.dbService.selectTable(table);
            }
        }
    };

    /**
     * Le glisser se poursuit hors du cadre : on écoute le document, le temps du geste.
     */
    private attachDocumentListeners(): void {
        document.addEventListener("mousemove", this.onMouseMove);
        document.addEventListener("mouseup", this.onMouseUp);
    }

    private detachDocumentListeners(): void {
        document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("mouseup", this.onMouseUp);
    }
}
