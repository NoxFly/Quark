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

import { computed, effect, inject, Injectable, Injector, signal, untracked } from "@angular/core";
import type {
    R_SessionRevertAllBody,
    R_SessionRevertBody,
    SessionDiffSnapshot,
    SessionDiffSummary,
    SessionRevertResult,
} from "@shared/session-diff";
import { DatabaseService } from "src/app/core/services/database.service";
import { NoxusService } from "src/app/core/services/noxus.service";

/** Compteurs d'un diff vide. */
const EMPTY_SUMMARY: SessionDiffSummary = { tables: 0, rows: 0, opaque: 0 };

/**
 * Accès au diff de la session de connexion courante.
 *
 * Le journal vit dans le processus principal : ce service n'en détient qu'une
 * copie de lecture. Les compteurs suivent en continu (badge de la barre d'état),
 * mais l'instantané complet — qui transporte le contenu réel des lignes — n'est
 * rechargé que lorsque la page de diff est affichée.
 */
@Injectable({ providedIn: "root" })
export class SessionDiffService {
    private readonly noxus = inject(NoxusService);
    private readonly injector = inject(Injector);

    /** Dernier instantané chargé, `null` tant qu'aucun chargement n'a eu lieu. */
    public readonly snapshot = signal<SessionDiffSnapshot | null>(null);

    /** Compteurs à jour, poussés par le main à chaque modification. */
    public readonly summary = signal<SessionDiffSummary>(EMPTY_SUMMARY);

    /** Un chargement de l'instantané est en cours. */
    public readonly loading = signal<boolean>(false);

    /** Dernière erreur de chargement, `null` si le dernier chargement a abouti. */
    public readonly error = signal<string | null>(null);

    /** La session porte au moins une modification. */
    public readonly hasChanges = computed(() => {
        const summary = this.summary();
        return summary.rows > 0 || summary.opaque > 0;
    });

    /**
     * Horodatage d'ouverture de la transaction courante, `null` hors transaction.
     * Une modification postérieure est « en attente » ; les autres sont validées.
     * Le main ne le transmet pas : il est relevé côté renderer au passage de
     * `inTransaction` à vrai (après un rechargement de la fenêtre en pleine
     * transaction, il vaut donc l'heure du rechargement).
     */
    public readonly transactionStartedAt = signal<number | null>(null);

    /** La page de diff est affichée : l'instantané doit suivre les modifications. */
    private live = false;

    /**
     * Branche l'écoute des notifications du main.
     * À appeler une seule fois, au démarrage de l'application.
     */
    public listen(): void {
        // `DatabaseService` dépend de ce service : il est résolu ici, après la
        // construction des deux, et non par `inject()` dans un champ.
        const dbService = this.injector.get(DatabaseService);

        effect(() => {
            const open = dbService.inTransaction();
            untracked(() => this.transactionStartedAt.set(open ? Date.now() : null));
        }, { injector: this.injector });

        this.noxus.ipc.onSessionDiffChanged(summary => {
            this.summary.set(summary);

            if (this.live) {
                void this.load();
            }
        });
    }

    /**
     * Déclare si la page de diff est affichée.
     *
     * Hors affichage, seules les notifications de compteurs sont traitées :
     * recharger l'instantané complet à chaque cellule éditée ferait transiter le
     * contenu de toutes les lignes modifiées par l'IPC, pour rien.
     *
     * @param live - `true` quand la page devient visible.
     */
    public setLive(live: boolean): void {
        this.live = live;

        if (live) {
            void this.load();
        }
    }

    /**
     * @description Indique si une modification faite à cet instant n'est pas encore validée.
     * @param timestamp - Horodatage de la modification (ms).
     */
    public isPending(timestamp: number): boolean {
        const startedAt = this.transactionStartedAt();

        return startedAt !== null && timestamp >= startedAt;
    }

    /**
     * Recharge l'instantané complet depuis le processus principal.
     */
    public async load(): Promise<void> {
        this.loading.set(true);

        try {
            const snapshot = await this.noxus.request<SessionDiffSnapshot>({
                method: "GET",
                path: "session-diff/snapshot",
            });

            this.snapshot.set(snapshot);
            this.summary.set(snapshot.summary);
            this.error.set(null);
        }
        catch (error) {
            this.error.set(error instanceof Error ? error.message : String(error));
        }
        finally {
            this.loading.set(false);
        }
    }

    /**
     * Efface le journal et redéfinit le point de référence du diff sur l'état
     * actuel de la base. N'annule aucune modification.
     */
    public async clear(): Promise<void> {
        const summary = await this.noxus.request<SessionDiffSummary>({
            method: "POST",
            path: "session-diff/clear",
        });

        this.summary.set(summary);
        await this.load();
    }

    /**
     * @description Remet une ligne dans son état d'origine en base (restaure une
     * modification, supprime une ligne insérée, réinsère une ligne supprimée),
     * puis recharge l'instantané.
     * @param body - Ligne à annuler.
     * @returns Le résultat de l'annulation, échecs compris.
     */
    public async revert(body: R_SessionRevertBody): Promise<SessionRevertResult> {
        return await this.applyRevert("session-diff/revert", body);
    }

    /**
     * @description Remet dans leur état d'origine les lignes ou tables désignées
     * (tout le journal si rien n'est désigné), puis recharge l'instantané.
     * @param body - Lignes et/ou tables à annuler.
     * @returns Le résultat de l'annulation, échecs compris.
     */
    public async revertAll(body: R_SessionRevertAllBody): Promise<SessionRevertResult> {
        return await this.applyRevert("session-diff/revert-all", body);
    }

    /**
     * Vide la copie locale, sans solliciter le main.
     * Appelé à la fermeture d'une base, quand le journal n'a plus d'objet.
     */
    public resetLocal(): void {
        this.snapshot.set(null);
        this.summary.set(EMPTY_SUMMARY);
        this.error.set(null);
    }

    /**
     * Envoie une annulation au main et recharge l'instantané, qu'elle ait
     * abouti ou non : un échec partiel a pu modifier une partie des lignes.
     */
    private async applyRevert(path: string, body: R_SessionRevertBody | R_SessionRevertAllBody): Promise<SessionRevertResult> {
        try {
            const result = await this.noxus.request<SessionRevertResult>({
                method: "POST",
                path,
                body,
            }, {
                // La durée dépend du nombre de lignes et de la base.
                timeout: 0,
            });

            this.summary.set(result.summary);

            return result;
        }
        finally {
            await this.load();
        }
    }
}
