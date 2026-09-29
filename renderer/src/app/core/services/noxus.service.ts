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

import { inject, Injectable, isDevMode } from "@angular/core";
import type { IResponse, RendererEventRegistry, RequestOptions } from "@noxfly/noxus/renderer";
import { IBatchRequestItem, IBatchResponsePayload, IRequest, NoxRendererClient } from "@noxfly/noxus/renderer";
import type { ErrorDialogPayload, IpcRendererBridge } from "@shared/ipc-renderer";
import { AlertController } from "@ui/alert/alert.controller";
import { BehaviorSubject, from, Observable } from "rxjs";
import { createIpcBridge } from "src/app/core/services/noxus-ipc.bridge";
import { jsonParseSafe } from "src/app/shared/helpers/global.helper";

/** Échéance par défaut d'une requête ; les opérations longues la désactivent. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Erreur levée quand le main répond par un statut d'échec.
 * Noxus rejette avec la réponse brute : sans cette conversion, les appelants
 * affichaient « [object Object] » à la place du message du main.
 */
export class NoxusRequestError extends Error {
    public constructor(public readonly status: number, message: string) {
        super(message);
        this.name = "NoxusRequestError";
    }
}

@Injectable({ providedIn: "root" })
export class NoxusService extends NoxRendererClient {
    /** API IPC de l'application, implémentée au-dessus des routes Noxus. */
    public readonly ipc: IpcRendererBridge = createIpcBridge(this);

    public declare readonly events: RendererEventRegistry;
    public declare setup: NoxRendererClient["setup"];
    public declare batch: NoxRendererClient["batch"];

    private readonly alertCtrl = inject(AlertController);

    public readonly bridgeReady = new BehaviorSubject<boolean>(false);

    /**
     * Résolue une fois la poignée de main faite. Une requête émise avant (par la
     * titlebar, qui s'initialise en même temps que l'application) l'attend au
     * lieu d'échouer faute de MessagePort.
     */
    private readonly ready: Promise<void>;
    private markReady!: () => void;

    public constructor() {
        super({
            requestTimeout: DEFAULT_REQUEST_TIMEOUT_MS,
            // Chaque réponse était journalisée avec son contenu : la console
            // gardait en mémoire les gros résultats, même en production.
            enableLogging: isDevMode(),
        });

        this.ready = new Promise(resolve => {
            this.markReady = resolve;
        });
    }

    /**
     *
     */
    public async init(): Promise<void> {
        await this.setup();

        this.ipc.whenDisplayErrorDialog(this.onErrorDialog.bind(this));

        this.markReady();
        this.bridgeReady.next(true);
    }

    /**
     * Envoie une requête au main, une fois le pont établi.
     * @throws NoxusRequestError si le main répond par une erreur.
     */
    public override async request<TResponse, TBody = unknown>(
        request: Omit<IRequest<TBody>, "requestId" | "senderId">,
        options?: RequestOptions,
    ): Promise<TResponse> {
        await this.ready;

        try {
            return await super.request<TResponse, TBody>(request, options);
        }
        catch (error) {
            throw toRequestError(error);
        }
    }

    /**
     *
     */
    private onErrorDialog(error: ErrorDialogPayload): void {
        this.alertCtrl.create({
            title: error.title ?? "An error occurred",
            message: error.message,
            color: "danger",
            actions: [
                {
                    text: "OK",
                    role: "cancel",
                },
                {
                    text: "Copy",
                    role: "none",
                    icon: "e8c8",
                    color: "danger-gradient",
                    handler: (self, action) => {
                        const err = structuredClone(error);
                        err.details = jsonParseSafe(err.details);

                        navigator.clipboard.writeText(JSON.stringify(err, null, 4));

                        action.text = "Copié !";
                        action.icon = "e73e";
                    },
                },
            ],
            details: error.details,
        });
    }

    /**
     * Requete le main process - Version Observable
     */
    public request$<T, U = any>(request: Omit<IRequest<U>, "requestId" | "senderId">, options?: RequestOptions): Observable<T> {
        return from(this.request<T, U>(request, options));
    }

    /**
     *
     */
    public batch$(requests: Omit<IBatchRequestItem<unknown>, "requestId">[]): Observable<IBatchResponsePayload> {
        return from(this.batch(requests));
    }
}

/**
 * Convertit un rejet Noxus (réponse d'erreur ou erreur de transport) en `Error`.
 */
function toRequestError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    if (typeof error === "object" && error !== null && "status" in error) {
        const response = error as IResponse;
        return new NoxusRequestError(response.status, response.error ?? `Request failed with status ${response.status}`);
    }

    return new Error(String(error));
}
