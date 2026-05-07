/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    OnDestroy,
    OnInit,
    signal,
    viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { I18nService } from "src/app/core/services/i18n.service";
import { DatabaseService } from "src/app/core/services/database.service";
import { StateService } from "src/app/core/services/state.service";
import { StoredProceduresService } from "src/app/core/services/stored-procedures.service";

/** Représente un résultat de recherche. */
interface SearchResult {
    label: string;
    type: "table" | "procedure";
    schema?: string;
}

/**
 * Barre de recherche globale (Ctrl+E) permettant de chercher
 * une table ou une procédure stockée par son nom.
 * Design similaire au sélecteur de thème.
 */
@Component({
    selector: "app-entity-search",
    standalone: true,
    templateUrl: "./entity-search.component.html",
    styleUrl: "./entity-search.component.scss",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "(window:keydown)": "onKeydown($event)",
    },
})
export class EntitySearchComponent implements OnInit, OnDestroy {
    private readonly i18n = inject(I18nService);
    private readonly dbService = inject(DatabaseService);
    private readonly state = inject(StateService);
    private readonly storedProcService = inject(StoredProceduresService);
    private readonly router = inject(Router);

    private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>("searchInput");

    protected readonly isOpen = signal<boolean>(false);
    protected readonly query = signal<string>("");
    protected readonly selectedIndex = signal<number>(0);

    /** Résultats filtrés basés sur la query. */
    protected readonly filteredResults = computed<SearchResult[]>(() => {
        const q = this.query().toLowerCase().trim();
        if (!q) {
            return this.allEntities();
        }
        return this.allEntities().filter(r => r.label.toLowerCase().includes(q));
    });

    /** Placeholder de l'input de recherche. */
    protected readonly placeholder = computed(() => {
        const hasProcs = this.state.capabilities()?.storedProcedures === true;
        return hasProcs
            ? this.i18n.t("entitySearch.placeholderWithProcs")
            : this.i18n.t("entitySearch.placeholder");
    });

    private readonly openHandler = (): void => this.open();

    public ngOnInit(): void {
        document.addEventListener("open-entity-search", this.openHandler);
    }

    public ngOnDestroy(): void {
        document.removeEventListener("open-entity-search", this.openHandler);
    }

    /**
     * Ouvre la barre de recherche.
     */
    private open(): void {
        this.query.set("");
        this.selectedIndex.set(0);
        this.isOpen.set(true);

        // Focus l'input après le rendu
        setTimeout(() => this.inputRef()?.nativeElement.focus(), 0);
    }

    /**
     * Ferme la barre de recherche.
     */
    protected close(): void {
        this.isOpen.set(false);
    }

    /**
     * Confirme la sélection courante.
     */
    protected confirm(): void {
        const results = this.filteredResults();
        const result = results[this.selectedIndex()];
        if (result) {
            this.selectResult(result);
        }
        this.close();
    }

    /**
     * Sélectionne un résultat via clic.
     */
    protected selectResultAtIndex(event: MouseEvent, index: number): void {
        event.stopPropagation();
        const results = this.filteredResults();
        const result = results[index];
        if (result) {
            this.selectResult(result);
        }
        this.close();
    }

    /**
     * Met à jour la requête de recherche.
     */
    protected onInput(value: string): void {
        this.query.set(value);
        this.selectedIndex.set(0);
    }

    /**
     * Gère la navigation clavier.
     */
    protected onKeydown(event: KeyboardEvent): void {
        if (!this.isOpen()) {
            return;
        }

        const results = this.filteredResults();

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.selectedIndex.update(i => Math.min(i + 1, results.length - 1));
                this.scrollToSelected();
                break;
            case "ArrowUp":
                event.preventDefault();
                this.selectedIndex.update(i => Math.max(i - 1, 0));
                this.scrollToSelected();
                break;
            case "Enter":
                event.preventDefault();
                this.confirm();
                break;
            case "Escape":
                event.preventDefault();
                this.close();
                break;
        }
    }

    /**
     * Construit la liste complète de toutes les entités disponibles.
     */
    private allEntities(): SearchResult[] {
        const entities: SearchResult[] = [];

        const db = this.state.database();
        if (db) {
            for (const table of db.tables) {
                entities.push({ label: table.name, type: "table" });
            }
        }

        if (this.state.capabilities()?.storedProcedures) {
            for (const proc of this.storedProcService.procedures()) {
                entities.push({ label: `${proc.schema}.${proc.name}`, type: "procedure", schema: proc.schema });
            }
        }

        return entities;
    }

    /**
     * Navigue vers l'entité sélectionnée.
     */
    private selectResult(result: SearchResult): void {
        if (result.type === "table") {
            this.dbService.selectTable(result.label);
        }
        else {
            // Procédure stockée : extraire schema et name
            const dotIdx = result.label.indexOf(".");
            const schema = result.schema ?? result.label.substring(0, dotIdx);
            const name = result.label.substring(dotIdx + 1);

            this.router.navigate(["/dashboard/stored-procedure"]).then(() => {
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent("open-stored-procedure", { detail: { name, schema } }));
                }, 50);
            });
        }
    }

    /**
     * Scroll la liste pour que l'élément sélectionné soit visible.
     */
    private scrollToSelected(): void {
        setTimeout(() => {
            const el = document.querySelector(".entity-search-list .selected");
            el?.scrollIntoView({ block: "nearest" });
        }, 0);
    }
}
