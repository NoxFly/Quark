/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { inject, Injectable, signal } from "@angular/core";
import type {
    R_StoredProcDetailBody,
    R_StoredProcDropBody,
    R_StoredProcExecBody,
    R_StoredProcListResponse,
    R_StoredProcModifyBody,
    StoredProcedureDef,
    StoredProcedureDetail,
    StoredProcedureExecResult,
} from "@shared/types";
import { NoxusService } from "src/app/core/services/noxus.service";
import { StateService } from "src/app/core/services/state.service";

/**
 * Service de gestion des procédures stockées (MSSQL uniquement).
 * Fournit les opérations CRUD et l'exécution des stored procedures.
 */
@Injectable({ providedIn: "root" })
export class StoredProceduresService {
    private readonly noxus = inject(NoxusService);
    private readonly state = inject(StateService);

    /** Liste des procédures stockées chargées. */
    public readonly procedures = signal<StoredProcedureDef[]>([]);

    /** Procédure actuellement sélectionnée (détail). */
    public readonly selectedProcedure = signal<StoredProcedureDetail | null>(null);

    /** Indique si le chargement est en cours. */
    public readonly loading = signal<boolean>(false);

    /**
     * Indique si les procédures stockées sont supportées pour le driver actuel.
     */
    public get isSupported(): boolean {
        return this.state.capabilities()?.storedProcedures === true;
    }

    /**
     * Charge la liste des procédures stockées.
     */
    public async loadProcedures(): Promise<void> {
        if (!this.isSupported) {
            return;
        }

        this.loading.set(true);

        try {
            const response = await this.noxus.request<R_StoredProcListResponse>({
                method: "GET",
                path: "db/stored-procedures",
            });
            this.procedures.set(response.procedures);
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Charge le détail complet d'une procédure stockée.
     */
    public async loadProcedureDetail(name: string, schema: string): Promise<StoredProcedureDetail> {
        const body: R_StoredProcDetailBody = { name, schema };
        const detail = await this.noxus.request<StoredProcedureDetail>({
            method: "GET",
            path: "db/stored-procedure-detail",
            body,
        });
        this.selectedProcedure.set(detail);
        return detail;
    }

    /**
     * Exécute une procédure stockée avec les paramètres fournis.
     */
    public async execProcedure(name: string, schema: string, params: Record<string, unknown>): Promise<StoredProcedureExecResult> {
        const body: R_StoredProcExecBody = { name, schema, params };
        return await this.noxus.request<StoredProcedureExecResult>({
            method: "GET",
            path: "db/stored-procedure-exec",
            body,
        });
    }

    /**
     * Modifie la définition d'une procédure stockée.
     */
    public async modifyProcedure(name: string, schema: string, definition: string): Promise<void> {
        const body: R_StoredProcModifyBody = { name, schema, definition };
        await this.noxus.request<void>({
            method: "GET",
            path: "db/stored-procedure-modify",
            body,
        });
    }

    /**
     * Supprime une procédure stockée.
     */
    public async dropProcedure(name: string, schema: string): Promise<void> {
        const body: R_StoredProcDropBody = { name, schema };
        await this.noxus.request<void>({
            method: "GET",
            path: "db/stored-procedure-drop",
            body,
        });
        this.procedures.update(list => list.filter(p => !(p.name === name && p.schema === schema)));
        if (this.selectedProcedure()?.name === name && this.selectedProcedure()?.schema === schema) {
            this.selectedProcedure.set(null);
        }
    }

    /**
     * Réinitialise l'état du service (lors de la déconnexion).
     */
    public reset(): void {
        this.procedures.set([]);
        this.selectedProcedure.set(null);
        this.loading.set(false);
    }
}
