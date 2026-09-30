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

import { inject, Logger, NoxSocket, type WindowManager } from "@noxfly/noxus/main";
import { shell } from "electron/common";
import { type BrowserWindow, type BrowserWindowConstructorOptions, dialog, screen } from "electron/main";
import { join, basename } from "node:path";
import { environment } from "src/core/environment";
import { RemoteDriver } from "src/core/driver-host/remote-driver";
import type { DatabaseDriverType } from "@shared/driver";
import type { ErrorDialogPayload } from "@shared/ipc-renderer";
import type { SessionOpaqueCategory, SessionRevertResult, SessionRowRef } from "@shared/session-diff";
import type { ShareSessionState } from "@shared/share";
import type { DatabaseSchema, DbRecord, R_TransactionAction } from "@shared/types";
import { AppEnv } from "src/core/env.dto";
import { SessionDiff } from "src/core/services/session-diff";
import { SessionReverter } from "src/core/services/session-revert";

const defaultWindowOptions: BrowserWindowConstructorOptions = {
    webPreferences: {
        devTools: environment.env === AppEnv.DEVELOPMENT,
        nodeIntegration: false,
        contextIsolation: true,
        // Le preload n'utilise que `contextBridge`, `ipcRenderer` et `webUtils` (chemin
        // d'un fichier déposé), tous disponibles dans un renderer sandboxé.
        sandbox: true,
        preload: join(environment.rootDir, "preload.js"),
        webSecurity: true,
    },
    center: true,
    show: false,
    autoHideMenuBar: true,
    transparent: false,
    frame: false,
    icon: join(environment.publicDir, "favicon.ico"),
    minHeight: 400,
    minWidth: 600,
    resizable: true,
    // Couleur de fond initiale + couleur de la bordure DWM (Windows 11) d'une fenêtre
    // frameless. En blanc pour s'accorder à l'application claire (au lieu du noir).
    backgroundColor: "#ffffff",
};

/**
 * Délai au-delà duquel la fenêtre est affichée même si `ready-to-show` n'a jamais
 * été émis. Sans ce filet, un renderer qui échoue à peindre laisse une fenêtre
 * invisible et une application apparemment morte.
 */
const READY_TO_SHOW_FALLBACK_MS = 8_000;

/**
 * Au-delà de ce nombre de lignes, une opération en lot est journalisée comme une
 * entrée récapitulative plutôt que ligne à ligne : capturer chaque image
 * coûterait autant de requêtes que de lignes, pour un diff illisible.
 */
const BULK_DETAIL_LIMIT = 500;

/** Délai avant l'échéance d'un partage auquel l'utilisateur est prévenu. */
const SHARE_EXPIRY_WARNING_MS = 5 * 60 * 1_000;

/** Message d'une action refusée sur une connexion partagée. */
const SHARE_FORBIDDEN_MESSAGE = "This action is not available on a shared connection.";

/**
 * Familles d'opérations limitées sur une connexion partagée : SQL libre, export,
 * modification du schéma (toujours refusées), et modification des valeurs
 * (refusée en consultation seule).
 */
export type ShareOperation = "sql" | "export" | "schema" | "write";

/** Connexion ouverte depuis un fichier de partage. */
export interface ShareSession extends ShareSessionState {
    /** Écart entre l'heure vérifiée en ligne et l'horloge du poste, en millisecondes. */
    clockOffsetMs: number;
}

/**
 * 1 instance par fenêtre (renderer).
 * Chaque fenêtre gère une seule connexion DB via un driver interchangeable.
 */
export class Window {
    private win: BrowserWindow | null = null;
    /**
     * Driver de la fenêtre. Il s'exécute dans un utilityProcess dédié : une
     * requête lourde ou un client bloqué ne gèle ni le main ni les autres fenêtres.
     */
    private readonly _database = new RemoteDriver(wasOpen => this.onDriverCrash(wasOpen));
    private readonly socket = inject(NoxSocket);
    private readonly _sessionDiff = new SessionDiff();
    private showFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    /** Connexion partagée en cours, `null` pour une connexion ordinaire. */
    private _share: ShareSession | null = null;
    private shareTimers: ReturnType<typeof setTimeout>[] = [];

    /**
     * Identifiants mémorisés à la création : ils doivent rester lisibles après la
     * destruction de la `BrowserWindow`, pour désenregistrer la fenêtre.
     */
    private windowId = -1;
    private webContentsId = -1;

    /**
     * Base à ouvrir dès que le renderer de cette fenêtre est prêt.
     *
     * Le fichier est attaché à la fenêtre plutôt qu'à l'application : deux
     * fenêtres peuvent démarrer en parallèle, et un compteur unique verrait la
     * seconde consommer le fichier destiné à la première.
     */
    private pendingFile: string | null = null;

    /**
     * Retourne le driver de base de données actif.
     */
    public get database(): RemoteDriver {
        return this._database;
    }

    /**
     * Change le type de driver (pour ouvrir un autre type de base).
     * Ferme le driver actuel si une connexion est ouverte.
     */
    public async setDriverType(type: DatabaseDriverType): Promise<void> {
        // Toute nouvelle connexion met fin à la connexion partagée éventuelle.
        this.endShareSession();

        // L'hôte ferme lui-même la connexion en cours avant de changer de driver.
        await this._database.switchTo(type);
        this._sessionDiff.reset();
    }

    /**
     * Connexion partagée en cours, `null` pour une connexion ordinaire.
     */
    public get share(): ShareSession | null {
        return this._share;
    }

    /**
     * Chemin ou adresse à montrer à l'utilisateur : le nom du partage pour une
     * connexion partagée, dont l'adresse ne doit pas être révélée.
     */
    public get displayPath(): string | null {
        return this._share?.name ?? this.database.path;
    }

    /**
     * Fait de la connexion ouverte une connexion partagée : titre, restrictions et
     * déconnexion à l'échéance.
     */
    public beginShareSession(session: ShareSession): void {
        this.endShareSession();
        this._share = session;
        this.updateTitle();
        this.scheduleShareExpiry(session);
    }

    /**
     * Refuse une opération interdite sur la connexion partagée en cours. Les
     * restrictions sont vérifiées ici, dans le main, et pas seulement masquées dans
     * l'interface.
     * @throws Si l'opération n'est pas permise.
     */
    public assertShareAllows(operation: ShareOperation): void {
        const share = this._share;

        if (!share || (operation === "write" && !share.readOnly)) {
            return;
        }

        throw new Error(SHARE_FORBIDDEN_MESSAGE);
    }

    /**
     * Crée une fenêtre et charge son document.
     *
     * @param windowManager - Gestionnaire de fenêtres Noxus.
     * @param onCreated - Appelé dès que la `BrowserWindow` existe, avant le
     * chargement du document. C'est le seul moment où l'appelant peut enregistrer
     * la fenêtre avant que son renderer ne commence à émettre des requêtes IPC :
     * enregistrée après le chargement, elle resterait introuvable par `senderId`
     * pendant toute son initialisation.
     */
    public static async create(
        windowManager: WindowManager,
        onCreated?: (window: Window) => void,
        onClosed?: (window: Window) => void,
    ): Promise<Window> {
        const window = new Window(windowManager, onClosed);
        await window.instantiate(onCreated);
        return window;
    }

    /**
     *
     */
    private constructor(
        private readonly windowManager: WindowManager,
        private readonly onClosed?: (window: Window) => void,
    ) {}

    /**
     *
     */
    public get id(): number {
        return this.windowId;
    }

    /**
     * Retourne le webContents.id (senderId pour Noxus).
     */
    public get senderId(): number {
        return this.webContentsId;
    }

    /**
     *
     */
    /**
     * Fenêtre native, pour parenter un dialogue. `null` une fois fermée.
     */
    public get browserWindow(): BrowserWindow | null {
        return this.win;
    }

    public get isFocused(): boolean {
        return this.win?.isFocused() ?? false;
    }

    /**
     * Journal des modifications de la session de connexion courante.
     */
    public get sessionDiff(): SessionDiff {
        return this._sessionDiff;
    }

    /**
     * Ouvre une base de données. Retourne true si un mot de passe est nécessaire.
     */
    public async openDatabase(filePath: string): Promise<boolean> {
        const needsPassword = await this.database.open(filePath);

        if (!needsPassword) {
            this.beginDiffSession();
            this.updateTitle();
        }

        return needsPassword;
    }

    /**
     * Déverrouille une base chiffrée.
     */
    public async unlockDatabase(password: string): Promise<void> {
        await this.database.unlock(password);
        this.beginDiffSession();
        this.updateTitle();
    }

    /**
     * Ferme la base de données.
     */
    public async closeDatabase(): Promise<void> {
        this.endShareSession();
        await this.database.close();
        this._sessionDiff.reset();
        this.notifySessionDiffChanged();
        this.updateTitle();
    }

    /**
     * Vide le journal et redéfinit son point de référence sur l'état actuel de la
     * base, sans toucher aux données.
     */
    public restartDiffSession(): void {
        this._sessionDiff.start(this.database.path);
        this.notifySessionDiffChanged();
    }

    /**
     * Ferme puis rouvre la même base sans interrompre le suivi des modifications.
     *
     * Un rafraîchissement relit la base ; il ne recommence pas la session de
     * l'utilisateur, et repartir d'un diff vide lui ferait perdre l'historique
     * de tout ce qu'il a modifié depuis l'ouverture.
     *
     * @param filePath - Chemin ou URI de la base à rouvrir.
     * @returns `true` si un mot de passe est nécessaire.
     */
    public async reopenDatabase(filePath: string): Promise<boolean> {
        await this.database.close();

        const needsPassword = await this.database.open(filePath);

        this.updateTitle();

        return needsPassword;
    }

    /**
     * Démarre le suivi des modifications pour la connexion qui vient de s'ouvrir.
     *
     * Le diff couvre la session entière et non la transaction courante : le point
     * de référence est donc l'ouverture de la base, pas un `BEGIN`.
     */
    private beginDiffSession(): void {
        const source = this.database.path;

        // Réouverture technique de la même base (saisie du mot de passe après un
        // rafraîchissement) : le journal doit survivre, pas repartir de zéro.
        if (this._sessionDiff.isTracking(source)) {
            return;
        }

        this._sessionDiff.start(source);
        this.notifySessionDiffChanged();
    }

    /**
     * Le process du driver s'est arrêté : la connexion est perdue. Le journal
     * de session décrivait une connexion qui n'existe plus.
     */
    private onDriverCrash(wasOpen: boolean): void {
        this.endShareSession();
        this._sessionDiff.reset();
        this.notifySessionDiffChanged();
        this.updateTitle();

        if (wasOpen) {
            this.sendToRenderer("display-error-dialog", {
                title: "Connection lost",
                message: "The database driver stopped unexpectedly and the connection was closed. Reopen the database to continue.",
            } satisfies ErrorDialogPayload);
        }
    }

    /**
     * Informe le renderer que le diff de session a changé, sans lui transmettre
     * son contenu : la page ne recharge l'instantané complet que si elle est ouverte.
     */
    private notifySessionDiffChanged(): void {
        this.sendToRenderer("session-diff-changed", this._sessionDiff.getSummary());
    }

    /**
     * Applique une action de transaction et aligne le journal sur la base.
     *
     * Le diff couvre la session et non la transaction : il enregistre donc les
     * écritures en attente comme les autres. Mais un `ROLLBACK` les annule
     * réellement, et le journal doit revenir en arrière avec la base — sinon il
     * afficherait des modifications qui n'existent plus.
     *
     * @param action - `begin`, `commit` ou `rollback`.
     */
    public async transactionAction(action: R_TransactionAction): Promise<void> {
        this.assertShareAllows("write");

        switch (action) {
            case "begin":
                await this.database.beginTransaction();
                this._sessionDiff.beginTransaction();
                break;

            case "commit":
                await this.database.commit();
                this._sessionDiff.commitTransaction();
                break;

            case "rollback":
                await this.database.rollback();
                this._sessionDiff.rollbackTransaction();
                break;
        }

        this.notifySessionDiffChanged();
    }

    /**
     * Lit une ligne sans laisser une erreur de driver interrompre la mutation
     * qu'elle accompagne : le diff est une commodité, jamais une raison d'échouer.
     */
    private async captureRow(table: string, rowid: number): Promise<DbRecord | null> {
        try {
            return await this.database.getRow(table, rowid);
        }
        catch (error) {
            Logger.warn(`Session diff: unable to capture ${table}#${rowid}: ${errorMessage(error)}`);
            return null;
        }
    }

    /**
     * Lit un lot de lignes pour le journal, dans la limite du seuil de détail.
     * @returns Les images lues, indexées par rowid, ou `null` si le lot dépasse le seuil.
     */
    private async captureRows(table: string, rowids: number[]): Promise<Map<number, DbRecord | null> | null> {
        if (rowids.length > BULK_DETAIL_LIMIT) {
            return null;
        }

        const images = new Map<number, DbRecord | null>();

        for (const rowid of rowids) {
            images.set(rowid, await this.captureRow(table, rowid));
        }

        return images;
    }

    /**
     * Modifie une cellule et enregistre l'effet dans le diff de session.
     */
    public async updateCell(table: string, rowid: number, column: string, value: unknown): Promise<void> {
        this.assertShareAllows("write");

        const before = await this.captureRow(table, rowid);
        await this.database.updateCell(table, rowid, column, value);
        const after = await this.captureRow(table, rowid);

        this._sessionDiff.recordUpdate(table, rowid, before, after);
        this.notifySessionDiffChanged();
    }

    /**
     * Applique la même valeur à plusieurs lignes et enregistre l'effet dans le diff.
     */
    public async batchUpdate(table: string, rowids: number[], column: string, value: unknown): Promise<void> {
        this.assertShareAllows("write");

        const before = await this.captureRows(table, rowids);

        await this.database.batchUpdate(table, rowids, column, value);

        if (!before) {
            this._sessionDiff.recordOpaque({
                category: "bulk",
                label: `Batch update on ${table}`,
                detail: `${column} = ${formatValue(value)}`,
                table,
                rowsAffected: rowids.length,
            });

            // Les lignes déjà au journal doivent rester justes : on relit leur seule
            // image courante. Les autres restent couvertes par l'entrée ci-dessus.
            for (const rowid of this._sessionDiff.trackedRowIds(table, rowids)) {
                const after = await this.captureRow(table, rowid);
                this._sessionDiff.recordUpdate(table, rowid, null, after);
            }
        }
        else {
            for (const rowid of rowids) {
                const after = await this.captureRow(table, rowid);
                this._sessionDiff.recordUpdate(table, rowid, before.get(rowid) ?? null, after);
            }
        }

        this.notifySessionDiffChanged();
    }

    /**
     * Supprime des lignes et enregistre l'effet dans le diff de session.
     */
    public async deleteRows(table: string, rowids: number[]): Promise<void> {
        this.assertShareAllows("write");

        const before = await this.captureRows(table, rowids);

        await this.database.deleteRows(table, rowids);

        if (!before) {
            this._sessionDiff.recordOpaque({
                category: "bulk",
                label: `Bulk delete on ${table}`,
                detail: `${rowids.length} rows deleted`,
                table,
                rowsAffected: rowids.length,
            });

            // Les lignes déjà au journal portent leur image d'origine : elles
            // deviennent des suppressions plutôt que de rester à un état obsolète.
            this._sessionDiff.markTrackedAsDeleted(table, rowids);
        }
        else {
            for (const rowid of rowids) {
                this._sessionDiff.recordDelete(table, rowid, before.get(rowid) ?? null);
            }
        }

        this.notifySessionDiffChanged();
    }

    /**
     * Vide une table et enregistre l'effet dans le diff de session.
     *
     * Jusqu'à `BULK_DETAIL_LIMIT` lignes, chacune est journalisée comme une
     * suppression, avec son image ; au-delà, une entrée récapitulative couvre
     * l'opération et les lignes déjà suivies deviennent des suppressions.
     * @returns Le nombre de lignes supprimées.
     */
    public async truncateTable(table: string): Promise<number> {
        this.assertShareAllows("schema");

        const images = await this.captureTable(table);
        const deleted = await this.database.truncateTable(table);

        if (images) {
            for (const [rowid, image] of images) {
                this._sessionDiff.recordDelete(table, rowid, image);
            }
        }
        else {
            this._sessionDiff.recordOpaque({
                category: "bulk",
                label: `Table ${table} emptied`,
                detail: `DELETE FROM ${table}`,
                table,
                rowsAffected: deleted,
            });

            this._sessionDiff.markTableAsDeleted(table);
        }

        this.notifySessionDiffChanged();

        return deleted;
    }

    /**
     * Lit toutes les lignes d'une table pour le journal, si elle ne dépasse pas
     * le seuil de détail.
     * @returns Les images par rowid, ou `null` si la table est trop grande ou si
     * ses lignes n'ont pas d'identifiant exploitable.
     */
    private async captureTable(table: string): Promise<Map<number, DbRecord> | null> {
        try {
            // Une ligne de plus que le seuil suffit à savoir qu'on le dépasse.
            const { records } = await this.database.getTableData(table, 0, BULK_DETAIL_LIMIT + 1);

            if (records.length > BULK_DETAIL_LIMIT) {
                return null;
            }

            const images = new Map<number, DbRecord>();

            for (const record of records) {
                const rowid = record["rowid"];

                if (typeof rowid !== "number" && typeof rowid !== "string") {
                    return null;
                }

                // L'identifiant d'un document MongoDB est une chaîne : le journal ne
                // s'en sert que comme clé, comme pour `deleteRows`.
                images.set(rowid as number, record);
            }

            return images;
        }
        catch (error) {
            Logger.warn(`Session diff: unable to capture ${table} before emptying it: ${errorMessage(error)}`);
            return null;
        }
    }

    /**
     * Insère une ligne et enregistre l'effet dans le diff de session.
     * @returns Le rowid créé et l'image de la ligne insérée.
     */
    public async insertRow(table: string, values: Record<string, unknown>): Promise<{ rowid: number; record: DbRecord | null }> {
        this.assertShareAllows("write");

        const rowid = await this.database.insertRow(table, values);
        const record = await this.captureRow(table, rowid);

        this._sessionDiff.recordInsert(table, rowid, record);
        this.notifySessionDiffChanged();

        return { rowid, record };
    }

    /**
     * Remet une ligne du diff de session dans son état d'origine.
     *
     * Passe par la fenêtre pour s'exécuter sur sa connexion, dans la transaction
     * éventuellement ouverte, et notifier le renderer comme toute mutation.
     * @param ref - Ligne à annuler.
     */
    public async revertSessionRow(ref: SessionRowRef): Promise<SessionRevertResult> {
        this.assertShareAllows("write");

        const result = await new SessionReverter(this.database, this._sessionDiff).revertRow(ref);

        this.notifySessionDiffChanged();

        return result;
    }

    /**
     * Remet dans leur état d'origine les lignes désignées du diff de session
     * (toutes si rien n'est désigné).
     * @param rows - Lignes à annuler.
     * @param tables - Tables dont toutes les lignes sont à annuler.
     */
    public async revertSessionRows(rows?: SessionRowRef[], tables?: string[]): Promise<SessionRevertResult> {
        this.assertShareAllows("write");

        const result = await new SessionReverter(this.database, this._sessionDiff).revertAll(rows, tables);

        this.notifySessionDiffChanged();

        return result;
    }

    /**
     * Enregistre dans le diff une opération dont l'effet ligne à ligne n'est pas
     * capturé (SQL brut, DDL, import de masse).
     */
    public recordOpaqueChange(change: {
        category: SessionOpaqueCategory;
        label: string;
        detail: string;
        table?: string | null;
        rowsAffected?: number | null;
    }): void {
        this._sessionDiff.recordOpaque(change);
        this.notifySessionDiffChanged();
    }

    /**
     * Récupère le schéma de la base de données ouverte.
     */
    public async getDatabaseSchema(): Promise<DatabaseSchema | null> {
        if (!this.database.isOpen) {
            return null;
        }

        const schema = await this.database.getSchema();

        // Le nom et le chemin d'une base partagée désignent son serveur.
        return this._share ? { ...schema, name: this._share.name, path: this._share.name } : schema;
    }

    /**
     * Met à jour le titre de la fenêtre.
     *
     * Sans base ouverte, le titre natif (barre des tâches, Alt+Tab) retombe sur le
     * nom de l'application plutôt qu'une chaîne vide : une fenêtre sans titre se
     * repère mal parmi les autres fenêtres ouvertes.
     */
    private updateTitle(): void {
        if (!this.win) {
            return;
        }

        const dbPath = this.database.path;
        const title = this._share?.name ?? (dbPath ? basename(dbPath) : environment.product.displayName);
        this.win.setTitle(title);
        this.sendToRenderer("title-changed", dbPath ? title : "");
    }

    /**
     * Programme l'avertissement puis la déconnexion d'un partage à échéance. Les
     * délais se comptent sur l'heure vérifiée en ligne à l'ouverture, pas sur
     * l'horloge du poste.
     */
    private scheduleShareExpiry(session: ShareSession): void {
        if (session.expiresAt === null) {
            return;
        }

        const remaining = session.expiresAt - (Date.now() + session.clockOffsetMs);
        const warning = () => this.sendToRenderer("share-expiring", {
            minutes: Math.max(1, Math.round(Math.min(remaining, SHARE_EXPIRY_WARNING_MS) / 60_000)),
        });

        this.shareTimers.push(
            setTimeout(warning, Math.max(0, remaining - SHARE_EXPIRY_WARNING_MS)),
            setTimeout(() => void this.expireShareSession(), Math.max(0, remaining)),
        );
    }

    /**
     * Déconnecte un partage arrivé à échéance. Une transaction en cours est
     * annulée d'abord, pour laisser la base dans un état propre.
     */
    private async expireShareSession(): Promise<void> {
        if (!this._share) {
            return;
        }

        try {
            if (this.database.isInTransaction) {
                await this.database.rollback();
            }
        }
        catch (error) {
            Logger.warn(`Rollback before share expiry failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
            await this.closeDatabase();
        }
        finally {
            this.sendToRenderer("share-expired");
        }
    }

    /**
     * Met fin à la connexion partagée : minuteurs annulés, restrictions levées.
     */
    private endShareSession(): void {
        for (const timer of this.shareTimers) {
            clearTimeout(timer);
        }

        this.shareTimers = [];

        if (this._share) {
            this._share = null;
            this._database.setRedactions([]);
        }
    }

    /**
     * Met une base en attente pour cette fenêtre, à ouvrir dès son renderer prêt.
     * @param filePath - Chemin de la base, ou `null` pour ne rien mettre en attente.
     */
    public setPendingFile(filePath: string | null): void {
        this.pendingFile = filePath;
    }

    /**
     * Retourne la base en attente et la consomme.
     */
    public takePendingFile(): string | null {
        const pending = this.pendingFile;
        this.pendingFile = null;

        return pending;
    }

    /**
     * Pousse un événement vers le renderer de cette fenêtre, par le socket Noxus.
     * @param event - Nom de l'événement écouté par le renderer.
     * @param payload - Données transmises au renderer.
     */
    public sendToRenderer(event: string, payload?: unknown): void {
        if (!this.win) {
            return;
        }

        // Le canal n'existe qu'une fois la poignée de main Noxus faite : un
        // événement émis avant est sans destinataire, comme l'était un
        // `webContents.send` sans écouteur.
        this.socket.emitToRenderer(this.senderId, event, payload);
    }

    /**
     * Met la fenêtre au premier plan.
     */
    public focus(): void {
        if (!this.win) {
            return;
        }

        if (this.win.isMinimized()) {
            this.win.restore();
        }

        // `show()` avant `focus()` : une fenêtre encore masquée — celle dont le
        // premier rendu n'a pas abouti — ne se met pas au premier plan sur le seul
        // appel à `focus()`, et l'utilisateur ne voit rien apparaître.
        this.win.show();
        this.win.focus();
    }

    /**
     *
     */
    private async instantiate(onCreated?: (window: Window) => void): Promise<void> {
        if (this.win) {
            return;
        }

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;

        const win = await this.windowManager.create({
            ...defaultWindowOptions,
            show: false,
            width: 1250,
            height: 750,
            maxWidth: width,
            maxHeight: height,
        }, true);

        this.win = win;
        this.windowId = win.id;
        this.webContentsId = win.webContents.id;

        // Les écouteurs de cycle de vie sont posés une seule fois pour la durée de vie
        // de la fenêtre : `load()` peut être rappelé (Ctrl+Alt+R) et les réenregistrer
        // à chaque passage accumulerait des écouteurs sur le même émetteur.
        this.registerLifecycleHandlers(win);
        this._database.warmUp();

        onCreated?.(this);

        await this.load();
    }

    /**
     *
     */
    public close(): void {
        if (!this.win) {
            return;
        }

        // L'écouteur `closed` libère le driver et désenregistre la fenêtre.
        this.win.close();
    }

    /**
     *
     */
    public reduce(): void {
        this.win?.minimize();
    }

    /**
     *
     */
    public maximize(): void {
        this.win?.maximize();
    }

    public toggleMaximize(): void {
        if (!this.win) {
            return;
        }

        if (this.win.isMaximized()) {
            this.win.unmaximize();
        }
        else {
            this.win.maximize();
        }
    }

    /**
     *
     */
    public toggleFullscreen(): void {
        if (!this.win) {
            return;
        }

        const isFullScreen = this.win.isFullScreen();

        if (!isFullScreen) {
            // Retirer les contraintes de taille max pour permettre le vrai plein écran
            this.win.setMaximumSize(0, 0);
        }

        this.win.setFullScreen(!isFullScreen);

        if (isFullScreen) {
            // Restaurer les contraintes de taille max après avoir quitté le plein écran
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.workAreaSize;
            this.win.setMaximumSize(width, height);
        }
    }

    /**
     *
     */
    public getTitlebarState(): {
        maximizable: boolean;
        minimizable: boolean;
        closable: boolean;
    } {
        return {
            minimizable: this.win?.isMinimizable() ?? false,
            maximizable: this.win?.isMaximizable() ?? false,
            closable: this.win?.isClosable() ?? false,
        };
    }

    // --------

    /**
     * Enregistre les écouteurs de cycle de vie et de diagnostic de la fenêtre.
     *
     * Sans eux, un échec de chargement, un crash du process de rendu ou une erreur
     * de preload se traduisent par une fenêtre blanche muette : aucun message pour
     * l'utilisateur, aucune trace exploitable dans les logs.
     */
    private registerLifecycleHandlers(win: BrowserWindow): void {
        // Une fermeture native (Alt+F4, barre des tâches) ne passe pas par
        // `close()` : sans cet écouteur, la fenêtre resterait référencée et son
        // process de driver continuerait de tourner.
        win.once("closed", () => {
            this.clearShowFallback();
            this.win = null;
            void this._database.dispose();
            this.onClosed?.(this);
        });

        win.on("ready-to-show", () => {
            this.clearShowFallback();
            win.show();
        });

        win.on("unresponsive", () => {
            Logger.critical(`Renderer ${win.id} is unresponsive.`);
        });

        win.on("responsive", () => {
            Logger.info(`Renderer ${win.id} is responsive again.`);
        });

        win.webContents.on("preload-error", (_event, preloadPath, error) => {
            Logger.critical(`Preload script failed (${preloadPath}): ${error.stack ?? error.message}`);
            this.reportFatal("Preload error", error.message);
        });

        win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            // -3 = ERR_ABORTED : émis quand une navigation en remplace une autre, sans conséquence.
            if (!isMainFrame || errorCode === -3) {
                return;
            }

            Logger.critical(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
            this.reportFatal("Loading error", `${errorDescription} (${errorCode})\n${validatedURL}`);
        });

        win.webContents.on("render-process-gone", (_event, details) => {
            Logger.critical(`Render process gone: reason=${details.reason}, exitCode=${details.exitCode}`);

            // « clean-exit » correspond à la fermeture volontaire de la fenêtre.
            if (details.reason === "clean-exit") {
                return;
            }

            this.reportFatal("Renderer crashed", `Reason: ${details.reason} (exit code ${details.exitCode})`);
        });

        // Toute navigation hors du document de l'application (drop d'un fichier sur
        // une zone non gérée, lien interne mal formé) remplacerait l'interface par la
        // cible : plus de titlebar, plus de raccourcis, aucun moyen de revenir. On la refuse.
        win.webContents.on("will-navigate", (event, url) => {
            if (this.isApplicationUrl(url)) {
                return;
            }

            Logger.warn(`Blocked in-window navigation to ${url}`);
            event.preventDefault();
        });
    }

    /**
     * Indique si l'URL correspond au document de l'application elle-même.
     */
    private isApplicationUrl(url: string): boolean {
        const current = this.win?.webContents.getURL();

        if (!current) {
            return false;
        }

        // Le routage Angular est en mode hash : seule la partie avant `#` identifie le document.
        const strip = (value: string): string => value.split("#")[0] ?? value;

        return strip(url) === strip(current);
    }

    /**
     * Affiche une erreur fatale du renderer dans une boîte de dialogue native.
     * Le dialogue natif est le seul canal fiable ici : l'interface Angular est,
     * par définition, indisponible.
     */
    private reportFatal(title: string, message: string): void {
        this.clearShowFallback();
        this.win?.show();

        const answer = dialog.showMessageBoxSync({
            type: "error",
            title: `${environment.product.displayName} — ${title}`,
            message: `${title}\n\n${message}`,
            buttons: ["Reload", "Close"],
            defaultId: 0,
            cancelId: 1,
        });

        if (answer === 0) {
            void this.reloadRenderer();
            return;
        }

        this.close();
    }

    /**
     * Arme le filet de sécurité qui affiche la fenêtre même si `ready-to-show`
     * n'est jamais émis.
     */
    private armShowFallback(): void {
        this.clearShowFallback();

        this.showFallbackTimer = setTimeout(() => {
            this.showFallbackTimer = null;

            if (this.win && !this.win.isVisible()) {
                Logger.warn(`ready-to-show never fired after ${READY_TO_SHOW_FALLBACK_MS}ms — showing window anyway.`);
                this.win.show();
            }
        }, READY_TO_SHOW_FALLBACK_MS);
    }

    /**
     *
     */
    private clearShowFallback(): void {
        if (this.showFallbackTimer !== null) {
            clearTimeout(this.showFallbackTimer);
            this.showFallbackTimer = null;
        }
    }

    /**
     * Charge (ou recharge) le document du renderer dans la fenêtre.
     */
    private async load(launchPage?: string): Promise<void> {
        const win = this.win;

        if (!win) {
            return;
        }

        this.armShowFallback();

        // ouvre les liens _target="blank" (externes) dans le navigateur par défaut
        win.webContents.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url);

            return {
                action: "deny",
            };
        });

        try {
            if (environment.env === AppEnv.DEVELOPMENT) {
                const url = `http://localhost:4201/${launchPage ? `#/${launchPage}` : ""}`;
                Logger.comment(`Loading URL: ${url}`);
                await win.loadURL(url);
            }
            else {
                // `loadFile` encode lui-même le chemin. Une URL `file://` construite à
                // la main casse dès que le dossier d'installation contient un espace,
                // un accent ou un `#` — écran blanc chez l'utilisateur, jamais chez le
                // développeur.
                const filePath = join(environment.rendererDir, "index.html");
                Logger.comment(`Loading file: ${filePath}`);
                await win.loadFile(filePath, launchPage ? { hash: `/${launchPage}` } : undefined);
            }
        }
        catch (error) {
            // `did-fail-load` a déjà rapporté le détail ; on empêche seulement le rejet
            // de remonter en unhandledRejection.
            Logger.critical(`Renderer load failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        if (launchPage) {
            this.sendToRenderer("navigate-to", launchPage);
        }
    }

    /**
     *
     */
    public is(win: BrowserWindow): boolean {
        return this.win?.id === win.id;
    }

    /**
     * Recharge le document du renderer (Ctrl+Alt+R).
     */
    public async reloadRenderer(): Promise<void> {
        await this.load();
    }
}

/**
 * Extrait un message lisible d'une erreur de driver.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Rend une valeur de cellule lisible dans le libellé d'une entrée de diff.
 */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return "NULL";
    }

    if (typeof value === "string") {
        return `"${value}"`;
    }

    return String(value);
}
