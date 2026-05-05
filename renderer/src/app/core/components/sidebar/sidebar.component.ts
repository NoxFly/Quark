import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from "@angular/core";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { StateService } from "src/app/core/services/state.service";
import { ButtonComponent } from "@ui/button/button.component";
import { ContextMenuComponent } from "src/app/shared/components/context-menu/context-menu.component";
import { TooltipDirective } from "src/app/shared/ui/components/tooltip/tooltip.directive";

@Component({
    selector: "app-sidebar",
    standalone: true,
    templateUrl: "./sidebar.component.html",
    styleUrl: "./sidebar.component.scss",
    imports: [ButtonComponent, ContextMenuComponent, TooltipDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[style.width.px]": "width()",
        "[class.connected]": "state.connected()",
    },
})
export class SidebarComponent {
    protected readonly state = inject(StateService);
    protected readonly dbService = inject(DatabaseService);
    protected readonly i18n = inject(I18nService);

    protected readonly width = signal<number>(220);
    protected readonly isResizing = signal<boolean>(false);

    protected readonly contextMenu = viewChild.required(ContextMenuComponent);

    /** Ensemble des tables actuellement dépliées dans la sidebar. */
    protected readonly expandedTables = signal<Set<string>>(new Set());

    protected readonly tables = computed(() => {
        const db = this.state.database();
        return db?.tables ?? [];
    });

    protected readonly selectedTable = computed(() => this.dbService.selectedTable());
    protected readonly isNoSql = computed(() => this.state.isNoSqlDatabase());

    /**
     * Sélectionne une table.
     */
    protected selectTable(tableName: string): void {
        this.dbService.selectTable(tableName);
    }

    /**
     * Déplie ou replie les détails d'une table.
     */
    protected toggleExpand(event: MouseEvent, tableName: string): void {
        event.stopPropagation();
        this.expandedTables.update(set => {
            const next = new Set(set);
            if (next.has(tableName)) {
                next.delete(tableName);
            }
            else {
                next.add(tableName);
            }
            return next;
        });
    }

    /**
     * Retourne true si la table est dépliée.
     */
    protected isExpanded(tableName: string): boolean {
        return this.expandedTables().has(tableName);
    }

    /**
     * Ouvre le menu contextuel pour une table.
     */
    protected onTableContextMenu(event: MouseEvent, tableName: string): void {
        const capabilities = this.state.capabilities();
        const isReadOnly = this.dbService.readOnly();
        const items: { label: string; icon?: string; action: () => void; separator?: boolean; danger?: boolean }[] = [];

        if (!isReadOnly && (!capabilities || capabilities.schemaEditing)) {
            items.push({
                label: this.i18n.t("sidebar.table.schemaEditor"),
                icon: "\uE70F",
                action: () => {
                    this.dbService.selectTable(tableName);
                    document.dispatchEvent(new CustomEvent("open-schema-editor"));
                },
            });
        }

        if (!capabilities || capabilities.indexes) {
            items.push({
                label: this.i18n.t("sidebar.table.indexViewer"),
                icon: "\uE773",
                action: () => {
                    this.dbService.selectTable(tableName);
                    document.dispatchEvent(new CustomEvent("open-index-viewer"));
                },
            });
        }

        if (!isReadOnly) {
            if (items.length > 0) {
                items.push({ label: "", action: () => {}, separator: true });
            }

            items.push({
                label: this.i18n.t(this.isNoSql() ? "sidebar.table.deleteTable.nosql" : "sidebar.table.deleteTable"),
                icon: "\uE74D",
                danger: true,
                action: () => void this.dbService.deleteTable(tableName),
            });
        }

        this.contextMenu().open(event, items);
    }

    /**
     * Démarre le redimensionnement de la sidebar.
     */
    protected startResize(event: MouseEvent): void {
        event.preventDefault();
        this.isResizing.set(true);

        const startX = event.clientX;
        const startWidth = this.width();

        const onMouseMove = (e: MouseEvent): void => {
            const delta = e.clientX - startX;
            const newWidth = Math.max(220, Math.min(500, startWidth + delta));
            this.width.set(newWidth);
        };

        const onMouseUp = (): void => {
            this.isResizing.set(false);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    /**
     * Rafraîchit la base de données.
     */
    protected refreshDatabase(): void {
        this.dbService.refreshDatabase();
    }

    /**
     * Ferme le fichier en cours.
     */
    protected closeFile(): void {
        this.dbService.closeFile();
    }
    /**
     * Dispatche l'événement d'ouverture du modal de création de table.
     */
    protected dispatchCreateTable(): void {
        document.dispatchEvent(new CustomEvent("open-create-table"));
    }
}
