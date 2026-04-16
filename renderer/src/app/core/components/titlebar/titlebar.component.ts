import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { DatabaseService } from "src/app/core/services/database.service";
import { I18nService } from "src/app/core/services/i18n.service";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";
import { TabsService, SQL_EDITOR_TAB_ID } from "src/app/core/services/tabs.service";
import { ThemeService } from "src/app/core/services/theme.service";
import { ChangePasswordComponent } from "src/app/shared/components/change-password/change-password.component";
import { CreateTableComponent } from "src/app/shared/components/create-table/create-table.component";
import { ImportDataComponent } from "src/app/shared/components/import-data/import-data.component";
import { IndexViewerComponent } from "src/app/shared/components/index-viewer/index-viewer.component";
import { SchemaEditorComponent } from "src/app/shared/components/schema-editor/schema-editor.component";
import { TransactionDiffComponent } from "src/app/shared/components/transaction-diff/transaction-diff.component";
import { DatabaseSchemaComponent } from "src/app/shared/components/database-schema/database-schema.component";
import { ShortcutsComponent } from "src/app/shared/components/shortcuts/shortcuts.component";
import { ModalController } from "src/app/shared/ui/components/modal/modal.controller";
import type { UIDismissData } from "src/app/shared/ui/ui.types";

interface MenuItem {
    label: string;
    shortcut?: string;
    action?: () => void;
    separator?: boolean;
    disabled?: boolean;
    children?: MenuItem[];
}

interface Menu {
    label: string;
    items: MenuItem[];
}

@Component({
    selector: "app-titlebar",
    standalone: true,
    templateUrl: "./titlebar.component.html",
    styleUrl: "./titlebar.component.scss",
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(document:click)": "closeMenus()",
        "(window:keydown.escape)": "closeMenus()",
    },
})
export class TitlebarComponent {
    private readonly noxus = inject(NoxusService);
    private readonly dbService = inject(DatabaseService);
    private readonly i18n = inject(I18nService);
    private readonly router = inject(Router);
    private readonly modalCtrl = inject(ModalController);
    private readonly tabsService = inject(TabsService);
    protected readonly state = inject(StateService);
    protected readonly themeService = inject(ThemeService);

    protected readonly openMenuIndex = signal<number | null>(null);
    protected readonly fileName = computed(() => this.state.fileName());
    protected readonly appName = computed(() => this.state.appName());

    protected readonly menus = computed<Menu[]>(() => {
        const connected = this.state.connected();
        const hasSelection = this.dbService.selectedCount() > 0;
        const capabilities = this.state.capabilities();
        // Track locale changes to re-compute menu labels
        const t = (key: string): string => this.i18n.t(key);

        const activeTableName = this.dbService.tabs.activeTab()?.tableName ?? this.dbService.selectedTable();
        const hasTable = !!activeTableName;
        const fields = this.dbService.tableSchema()?.fields ?? [];

        // --- Edit menu items ---
        const editItems: MenuItem[] = [
            { label: t("menu.undo"), shortcut: "Ctrl+Z", action: () => this.dbService.undoLastMutation(), disabled: !this.dbService.mutationHistory.canUndo() },
            { label: t("menu.redo"), shortcut: "Ctrl+Y", action: () => this.dbService.redoLastMutation(), disabled: !this.dbService.mutationHistory.canRedo() },
            { label: "", separator: true },
            { label: t("menu.toggleEditMode"), shortcut: "Ctrl+E", action: () => this.dbService.toggleReadOnly(), disabled: !connected },
        ];

        if (!capabilities || capabilities.transactions) {
            editItems.push(
                { label: "", separator: true },
                { label: t("menu.startTransaction"), shortcut: "Ctrl+T", action: () => this.dbService.transactionAction("begin"), disabled: !connected || this.dbService.inTransaction() },
                { label: t("menu.commitTransaction"), action: () => this.dbService.transactionAction("commit"), disabled: !this.dbService.inTransaction() },
                { label: t("menu.rollbackTransaction"), action: () => this.dbService.transactionAction("rollback"), disabled: !this.dbService.inTransaction() },
                { label: t("menu.transactionDiff"), action: () => this.openTransactionDiff(), disabled: !this.dbService.inTransaction() },
            );
        }

        editItems.push(
            { label: "", separator: true },
            { label: t("menu.deleteSelection"), action: () => this.dbService.deleteSelectedRows(), disabled: !hasSelection },
        );

        if (!capabilities || capabilities.importExport) {
            editItems.push(
                { label: t("menu.importData"), action: () => this.openImportData(), disabled: !connected || !hasTable },
                { label: "", separator: true },
                {
                    label: t("menu.export"),
                    disabled: !hasSelection,
                    children: [
                        { label: t("menu.exportJson"), action: () => this.dbService.exportData("json", true), disabled: !hasSelection },
                        { label: t("menu.exportCsv"), action: () => this.dbService.exportData("csv", true), disabled: !hasSelection },
                        { label: t("menu.exportXlsx"), action: () => this.dbService.exportData("xlsx", true), disabled: !hasSelection },
                    ],
                },
            );
        }

        // --- View menu items ---
        const viewItems: MenuItem[] = [];

        if (!capabilities || capabilities.sqlQueries) {
            viewItems.push(
                { label: t("menu.sqlEditor"), shortcut: "Ctrl+Shift+Q", action: () => this.openSqlEditorTab(), disabled: !connected },
            );
        }

        if (!capabilities || capabilities.erDiagram) {
            viewItems.push(
                { label: t("menu.erDiagram"), action: () => this.router.navigate(["/dashboard/er-diagram"]), disabled: !connected },
            );
        }

        if (viewItems.length > 0) {
            viewItems.push({ label: "", separator: true });
        }

        viewItems.push(
            { label: t("menu.fullscreen"), shortcut: "F11", action: () => this.noxus.ipc.toggleFullscreen() },
            { label: "", separator: true },
            { label: t("menu.changeTheme"), shortcut: "Ctrl+K Ctrl+T", action: () => this.openThemePicker() },
            { label: "", separator: true },
            {
                label: t("menu.language"),
                children: this.i18n.availableLocales.map(locale => ({
                    label: this.i18n.localeLabels[locale],
                    action: () => this.i18n.setLocale(locale),
                    disabled: this.i18n.locale() === locale,
                })),
            },
        );

        // --- Database menu items ---
        const databaseItems: MenuItem[] = [];

        if (!capabilities || capabilities.schemaEditing) {
            databaseItems.push(
                { label: t("menu.schemaEditor"), action: () => this.openSchemaEditor(fields), disabled: !connected || !hasTable },
                { label: t("menu.createTable"), action: () => this.openCreateTable(), disabled: !connected },
            );
        }

        if (!capabilities || capabilities.indexes) {
            databaseItems.push(
                { label: t("menu.indexViewer"), action: () => this.openIndexViewer(fields), disabled: !connected || !hasTable },
            );
        }

        databaseItems.push(
            { label: t("menu.viewSchema"), action: () => this.openDatabaseSchema(), disabled: !connected },
        );

        if (!capabilities || capabilities.encryption) {
            if (databaseItems.length > 0) {
                databaseItems.push({ label: "", separator: true });
            }
            databaseItems.push(
                { label: t("menu.changePassword"), action: () => this.openChangePassword(), disabled: !connected },
            );
        }

        return [
            {
                label: t("menu.file"),
                items: [
                    { label: t("menu.open"), shortcut: "Ctrl+O", action: () => this.dbService.openFileDialog() },
                    { label: t("menu.newWindow"), shortcut: "Ctrl+Shift+N", action: () => this.noxus.ipc.newWindow() },
                    { label: "", separator: true },
                    { label: t("menu.refresh"), shortcut: "Ctrl+Shift+R", action: () => this.dbService.refreshDatabase(), disabled: !connected },
                    { label: t(capabilities?.networkConnection ? "menu.disconnect" : "menu.closeFile"), shortcut: "Ctrl+K Ctrl+F", action: () => this.dbService.closeFile(), disabled: !connected },
                    { label: "", separator: true },
                    { label: t("menu.quit"), shortcut: "Alt+F4", action: () => this.noxus.ipc.quitApp() },
                ],
            },
            {
                label: t("menu.edit"),
                items: editItems,
            },
            {
                label: t("menu.view"),
                items: viewItems,
            },
            {
                label: t("menu.database"),
                items: databaseItems,
            },
            {
                label: t("menu.help"),
                items: [
                    { label: t("menu.shortcuts"), action: () => this.openShortcuts() },
                    { label: "", separator: true },
                    { label: t("menu.about"), action: () => this.openAbout() },
                ],
            },
        ];
    });

    /**
     * Toggle un menu par son index.
     */
    protected toggleMenu(event: MouseEvent, index: number): void {
        event.stopPropagation();
        this.openMenuIndex.update(current => current === index ? null : index);
    }

    /**
     * Survol d'un menu quand un autre est déjà ouvert.
     */
    protected onMenuHover(index: number): void {
        if (this.openMenuIndex() !== null) {
            this.openMenuIndex.set(index);
        }
    }

    /**
     * Exécute l'action d'un item de menu.
     */
    protected executeMenuItem(event: MouseEvent, item: MenuItem): void {
        event.stopPropagation();
        if (item.disabled || item.separator || !item.action) {
            return;
        }
        item.action();
        this.closeMenus();
    }

    /**
     * Ferme tous les menus.
     */
    protected closeMenus(): void {
        this.openMenuIndex.set(null);
    }

    protected closeApp(): void {
        this.noxus.ipc.close();
    }

    protected reduceApp(): void {
        this.noxus.ipc.reduce();
    }

    protected toggleMaximize(): void {
        this.noxus.ipc.toggleMaximize();
    }

    /**
     * Ouvre le sélecteur de thème.
     * Dispatche un événement personnalisé sur le document pour que le composant ThemePicker le capte.
     */
    private openThemePicker(): void {
        document.dispatchEvent(new CustomEvent("open-theme-picker"));
    }

    /**
     * Ouvre l'éditeur SQL en tant qu'onglet dédié.
     */
    private openSqlEditorTab(): void {
        this.tabsService.openTab(SQL_EDITOR_TAB_ID);
        this.dbService.selectedTable.set(null);
        this.router.navigate(["/dashboard/sql-editor"]);
    }

    /**
     * Ouvre la modale de visualisation du schéma de la base.
     */
    private async openDatabaseSchema(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: DatabaseSchemaComponent,
            componentProps: {},
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<DatabaseSchemaComponent>();
        if (comp) {
            comp.dismiss = () => modal.dismiss();
        }
    }

    /**
     * Ouvre la modale "À propos".
     * Dispatche un événement personnalisé pour que le composant AppComponent l'intercepte.
     */
    private openAbout(): void {
        document.dispatchEvent(new CustomEvent("open-about-dialog"));
    }

    /**
     * Ouvre la modale des raccourcis clavier.
     */
    private async openShortcuts(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: ShortcutsComponent,
            componentProps: {},
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<ShortcutsComponent>();
        if (comp) {
            comp.dismiss = () => modal.dismiss();
        }
    }

    /**
     * Ouvre le modal d'import de données pour la table active.
     */
    private async openImportData(): Promise<void> {
        const table = this.dbService.selectedTable();
        if (!table) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: ImportDataComponent,
            componentProps: { tableName: table },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<ImportDataComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
        modal.didDismiss.subscribe(async result => {
            if (result.data?.["imported"] === true) {
                await this.dbService.loadTableData(true);
            }
        });
    }

    /**
     * Ouvre le modal d'édition de schéma de la table active.
     */
    private async openSchemaEditor(fields: import("@shared/types").FieldDef[]): Promise<void> {
        const table = this.dbService.selectedTable();
        if (!table || fields.length === 0) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: SchemaEditorComponent,
            componentProps: { tableName: table, fields },
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<SchemaEditorComponent>();
        if (comp) {
            comp.dismiss = async data => {
                if (data?.["changed"] === true) {
                    const actions = comp.getAlterActions();
                    for (const action of actions) {
                        await this.dbService.alterTable(action);
                    }
                }
                modal.dismiss(data as Partial<UIDismissData>);
            };
        }
    }

    /**
     * Ouvre le modal de création d'une nouvelle table.
     */
    private async openCreateTable(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: CreateTableComponent,
            componentProps: {},
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<CreateTableComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
        modal.didDismiss.subscribe(async result => {
            if (result.role === "confirm") {
                await this.dbService.refreshDatabase();
            }
        });
    }

    /**
     * Ouvre le modal de visualisation des index de la table active.
     */
    private async openIndexViewer(fields: import("@shared/types").FieldDef[]): Promise<void> {
        const table = this.dbService.selectedTable();
        if (!table) {
            return;
        }
        const modal = await this.modalCtrl.create({
            component: IndexViewerComponent,
            componentProps: { tableName: table, fields },
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<IndexViewerComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }

    /**
     * Ouvre le modal de changement de mot de passe / chiffrement.
     */
    private async openChangePassword(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: ChangePasswordComponent,
            componentProps: {},
            backdropClose: false,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<ChangePasswordComponent>();
        if (comp) {
            comp.dismiss = data => modal.dismiss(data as Partial<UIDismissData>);
        }
    }

    /**
     * Ouvre le modal de diff des mutations en attente.
     */
    private async openTransactionDiff(): Promise<void> {
        const modal = await this.modalCtrl.create({
            component: TransactionDiffComponent,
            componentProps: {},
            backdropClose: true,
            showDots: false,
            blurry: false,
        });
        const comp = modal.getComponentInstance<TransactionDiffComponent>();
        if (comp) {
            comp.dismiss = () => modal.dismiss();
        }
    }
}
