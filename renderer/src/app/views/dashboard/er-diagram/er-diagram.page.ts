/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from "@angular/core";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import type { DatabaseSchema, FieldDef, TableSchema } from "@shared/types";

/** Coordonnées d'un nœud de table sur le diagramme. */
interface TableNode {
    table: TableSchema;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Connexion FK entre deux tables. */
interface FkLink {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    path: string;
}

/** État d'un drag de nœud en cours. */
interface DragState {
    nodeIndex: number;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
}

/** État du pan (déplacement de la vue). */
interface PanState {
    startMouseX: number;
    startMouseY: number;
    startScrollX: number;
    startScrollY: number;
}

/**
 * Page de diagramme entité-relation (ER Diagram).
 * Affiche les tables de la base de données avec leurs colonnes et clés étrangères.
 * Les nœuds sont repositionnables par drag & drop.
 * La vue est pannable et zoomable.
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
    private readonly destroyRef = inject(DestroyRef);

    private readonly COL_WIDTH = 260;
    private readonly ROW_HEIGHT = 28;
    private readonly HEADER_HEIGHT = 36;
    private readonly H_GAP = 60;
    private readonly V_GAP = 48;
    private readonly MIN_ZOOM = 0.2;
    private readonly MAX_ZOOM = 2.5;
    private readonly ZOOM_STEP = 0.15;
    /** Marge supplémentaire autour du contenu pour permettre le pan. */
    private readonly PAN_PADDING = 200;
    /** Ratio largeur/hauteur cible pour le layout en grille (paysage 16:9). */
    private readonly TARGET_ASPECT_RATIO = 16 / 9;

    /** Positions modifiables des nœuds (permet le drag & drop). */
    protected readonly nodes = signal<TableNode[]>([]);

    /** Niveau de zoom courant. */
    protected readonly zoom = signal<number>(1);

    /** Index du nœud en cours de drag (ou -1). */
    private dragState: DragState | null = null;

    /** État du pan en cours. */
    private panState: PanState | null = null;

    /** Référence au conteneur scrollable. */
    private readonly wrapperRef = viewChild<ElementRef<HTMLDivElement>>("erWrapper");

    /** Liens FK recalculés quand les nodes bougent. */
    protected readonly links = computed<FkLink[]>(() => this.computeLinks(this.nodes()));

    /** Taille totale du canvas SVG (en coordonnées logiques, avant zoom). */
    protected readonly canvasSize = computed(() => {
        const nodes = this.nodes();
        if (nodes.length === 0) {
            return { width: 600, height: 400 };
        }
        const z = this.zoom();
        const maxX = Math.max(...nodes.map(n => n.x + n.width)) + this.PAN_PADDING;
        const maxY = Math.max(...nodes.map(n => n.y + n.height)) + this.PAN_PADDING;
        return { width: maxX * z, height: maxY * z };
    });

    /** Libellé du zoom en %. */
    protected readonly zoomLabel = computed(() => `${Math.round(this.zoom() * 100)}%`);

    public constructor() {
        effect(() => {
            const db = this.state.database();
            if (db) {
                this.nodes.set(this.layoutNodes(db));
            }
            else {
                this.nodes.set([]);
            }
        });

        this.destroyRef.onDestroy(() => {
            document.removeEventListener("mousemove", this.onNodeMouseMove);
            document.removeEventListener("mouseup", this.onNodeMouseUp);
            document.removeEventListener("mousemove", this.onPanMouseMove);
            document.removeEventListener("mouseup", this.onPanMouseUp);
        });
    }

    /**
     * Retourne la hauteur d'une table (header + lignes colonnes).
     */
    protected getTableHeight(table: TableSchema): number {
        return this.HEADER_HEIGHT + table.fields.length * this.ROW_HEIGHT;
    }

    /**
     * Retourne le badge d'un champ (PK, FK).
     */
    protected getFieldBadge(field: FieldDef): string {
        if (field.pk) {
            return "PK";
        }
        if (field.fk) {
            return "FK";
        }
        return "";
    }

    /**
     * Démarre le drag d'un nœud.
     */
    protected startDrag(event: MouseEvent, index: number): void {
        event.preventDefault();
        event.stopPropagation();

        const node = this.nodes()[index];
        if (!node) {
            return;
        }

        this.dragState = {
            nodeIndex: index,
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            startNodeX: node.x,
            startNodeY: node.y,
        };

        document.addEventListener("mousemove", this.onNodeMouseMove);
        document.addEventListener("mouseup", this.onNodeMouseUp);
    }

    /**
     * Démarre le pan de la vue quand on click sur le fond du canvas.
     */
    protected startPan(event: MouseEvent): void {
        // Ne pas démarrer un pan si on est sur un nœud
        if ((event.target as Element).closest(".table-node")) {
            return;
        }

        event.preventDefault();

        const wrapper = this.wrapperRef()?.nativeElement;
        if (!wrapper) {
            return;
        }

        this.panState = {
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            startScrollX: wrapper.scrollLeft,
            startScrollY: wrapper.scrollTop,
        };

        document.addEventListener("mousemove", this.onPanMouseMove);
        document.addEventListener("mouseup", this.onPanMouseUp);
    }

    /**
     * Zoome avec la molette de la souris (Ctrl+wheel).
     */
    protected onWheelZoom(event: WheelEvent): void {
        if (!event.ctrlKey) {
            return;
        }
        event.preventDefault();
        const delta = event.deltaY > 0 ? -this.ZOOM_STEP : this.ZOOM_STEP;
        this.zoom.update(z => Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, +(z + delta).toFixed(2))));
    }

    protected zoomIn(): void {
        this.zoom.update(z => Math.min(this.MAX_ZOOM, +(z + this.ZOOM_STEP).toFixed(2)));
    }

    protected zoomOut(): void {
        this.zoom.update(z => Math.max(this.MIN_ZOOM, +(z - this.ZOOM_STEP).toFixed(2)));
    }

    protected resetZoom(): void {
        this.zoom.set(1);
    }

    /** Handler mousemove pour le déplacement d'un nœud. */
    private readonly onNodeMouseMove = (event: MouseEvent): void => {
        if (!this.dragState) {
            return;
        }
        const z = this.zoom();
        const dx = (event.clientX - this.dragState.startMouseX) / z;
        const dy = (event.clientY - this.dragState.startMouseY) / z;
        const newX = Math.max(0, this.dragState.startNodeX + dx);
        const newY = Math.max(0, this.dragState.startNodeY + dy);
        const idx = this.dragState.nodeIndex;
        this.nodes.update(nodes => nodes.map((n, i) => i === idx ? { ...n, x: newX, y: newY } : n));
    };

    /** Handler mouseup pour la fin du déplacement d'un nœud. */
    private readonly onNodeMouseUp = (): void => {
        this.dragState = null;
        document.removeEventListener("mousemove", this.onNodeMouseMove);
        document.removeEventListener("mouseup", this.onNodeMouseUp);
    };

    /** Handler mousemove pour le pan. */
    private readonly onPanMouseMove = (event: MouseEvent): void => {
        if (!this.panState) {
            return;
        }
        const wrapper = this.wrapperRef()?.nativeElement;
        if (!wrapper) {
            return;
        }
        const dx = event.clientX - this.panState.startMouseX;
        const dy = event.clientY - this.panState.startMouseY;
        wrapper.scrollLeft = this.panState.startScrollX - dx;
        wrapper.scrollTop = this.panState.startScrollY - dy;
    };

    /** Handler mouseup pour la fin du pan. */
    private readonly onPanMouseUp = (): void => {
        this.panState = null;
        document.removeEventListener("mousemove", this.onPanMouseMove);
        document.removeEventListener("mouseup", this.onPanMouseUp);
    };

    /**
     * Calcule le nombre optimal de colonnes pour un ratio approchant 1:1.
     * Essaie chaque valeur de colonnes (1..tableCount) et retient celle
     * dont le rapport largeur/hauteur est le plus proche de 1.
     */
    private computeOptimalCols(db: DatabaseSchema): number {
        const n = db.tables.length;
        if (n <= 1) {
            return 1;
        }

        const avgFieldCount = db.tables.reduce((sum, t) => sum + t.fields.length, 0) / n;
        const avgHeight = this.HEADER_HEIGHT + avgFieldCount * this.ROW_HEIGHT;
        const cellW = this.COL_WIDTH + this.H_GAP;
        const cellH = avgHeight + this.V_GAP;

        let bestCols = 1;
        let bestRatio = Infinity;

        for (let cols = 1; cols <= n; cols++) {
            const rows = Math.ceil(n / cols);
            const totalW = cols * cellW;
            const totalH = rows * cellH;
            const ratio = Math.abs(totalW / totalH - this.TARGET_ASPECT_RATIO);

            if (ratio < bestRatio) {
                bestRatio = ratio;
                bestCols = cols;
            }
        }

        return bestCols;
    }

    /**
     * Calcule les positions initiales des nœuds en grille.
     */
    private layoutNodes(db: DatabaseSchema): TableNode[] {
        const nodes: TableNode[] = [];
        const tableCount = db.tables.length;
        const colsPerRow = this.computeOptimalCols(db);

        const rowCount = Math.ceil(tableCount / colsPerRow);
        const rowMaxHeights: number[] = [];

        for (let r = 0; r < rowCount; r++) {
            let maxH = 0;
            for (let c = 0; c < colsPerRow; c++) {
                const tableIdx = r * colsPerRow + c;
                if (tableIdx >= tableCount) {
                    break;
                }
                const table = db.tables[tableIdx];
                if (table) {
                    maxH = Math.max(maxH, this.getTableHeight(table));
                }
            }
            rowMaxHeights.push(maxH);
        }

        const rowY: number[] = [];
        let cumulativeY = this.V_GAP;
        for (let r = 0; r < rowCount; r++) {
            rowY.push(cumulativeY);
            cumulativeY += (rowMaxHeights[r] ?? 0) + this.V_GAP;
        }

        for (let i = 0; i < tableCount; i++) {
            const table = db.tables[i];
            if (!table) {
                continue;
            }

            const col = i % colsPerRow;
            const row = Math.floor(i / colsPerRow);

            nodes.push({
                table,
                x: this.H_GAP + col * (this.COL_WIDTH + this.H_GAP),
                y: rowY[row] ?? this.V_GAP,
                width: this.COL_WIDTH,
                height: this.getTableHeight(table),
            });
        }

        return nodes;
    }

    /**
     * Calcule les chemins SVG pour les liens FK.
     */
    private computeLinks(nodes: TableNode[]): FkLink[] {
        const links: FkLink[] = [];
        const nodeMap = new Map(nodes.map(n => [n.table.name, n]));

        for (const sourceNode of nodes) {
            for (const field of sourceNode.table.fields) {
                if (!field.fk) {
                    continue;
                }

                const targetNode = nodeMap.get(field.fk.table);
                if (!targetNode) {
                    continue;
                }

                const fieldIndex = sourceNode.table.fields.indexOf(field);
                const fromY = sourceNode.y + this.HEADER_HEIGHT + fieldIndex * this.ROW_HEIGHT + this.ROW_HEIGHT / 2;

                const targetFieldIndex = targetNode.table.fields.findIndex(f => f.name === field.fk!.column);
                const toY = targetFieldIndex >= 0
                    ? targetNode.y + this.HEADER_HEIGHT + targetFieldIndex * this.ROW_HEIGHT + this.ROW_HEIGHT / 2
                    : targetNode.y + this.HEADER_HEIGHT / 2;

                const sourceRight = sourceNode.x + sourceNode.width;
                const targetRight = targetNode.x + targetNode.width;

                let fromX: number;
                let toX: number;

                if (sourceNode.x > targetRight) {
                    fromX = sourceNode.x;
                    toX = targetRight;
                }
                else if (sourceRight < targetNode.x) {
                    fromX = sourceRight;
                    toX = targetNode.x;
                }
                else {
                    fromX = sourceRight;
                    toX = targetNode.x;
                }

                const midX = (fromX + toX) / 2;
                const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

                links.push({
                    fromTable: sourceNode.table.name,
                    fromColumn: field.name,
                    toTable: field.fk.table,
                    toColumn: field.fk.column,
                    path,
                });
            }
        }

        return links;
    }
}
