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

import { Controller, Get, inject, Post, type Request } from "@noxfly/noxus/main";
import type {
    ConnectionConnectResult,
    ConnectionFolder,
    ConnectionFolderInput,
    ConnectionMasterPasswordBody,
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionTagDef,
    ConnectionTagInput,
    ConnectionVaultStatus,
} from "@shared/connection";
import { ConnectionsService } from "src/modules/connections/connections.service";

/**
 * Coffre chiffré des profils de connexion.
 */
@Controller()
export class ConnectionsController {
    private readonly connections = inject(ConnectionsService);

    /**
     * État du coffre. Sans mot de passe maître, le lire suffit à déverrouiller le
     * coffre par le trousseau du système.
     */
    @Get("status")
    public async getStatus(): Promise<ConnectionVaultStatus> {
        return await this.connections.store.getStatus();
    }

    /**
     * Active ou désactive la protection du coffre par mot de passe maître.
     */
    @Post("master-password")
    public async setMasterPassword(request: Request): Promise<void> {
        await this.connections.store.setMasterPassword(request.body as ConnectionMasterPasswordBody);
    }

    @Post("initialize")
    public async initialize(request: Request): Promise<void> {
        const { masterPassword } = request.body as { masterPassword: string };
        await this.connections.store.initialize(masterPassword);
    }

    @Post("unlock")
    public async unlock(request: Request): Promise<boolean> {
        const { masterPassword } = request.body as { masterPassword: string };
        return await this.connections.store.unlock(masterPassword);
    }

    @Post("lock")
    public lock(): void {
        this.connections.store.lock();
    }

    @Get("list")
    public list(): ConnectionProfile[] {
        return this.connections.store.list();
    }

    @Post("create")
    public async create(request: Request): Promise<ConnectionProfile> {
        const { input } = request.body as { input: ConnectionProfileInput };
        return await this.connections.store.create(input);
    }

    @Post("update")
    public async update(request: Request): Promise<ConnectionProfile> {
        const { id, input } = request.body as { id: string; input: ConnectionProfileInput };
        return await this.connections.store.update(id, input);
    }

    @Post("delete")
    public async delete(request: Request): Promise<void> {
        const { id } = request.body as { id: string };
        await this.connections.store.delete(id);
    }

    /**
     * Déplace un profil (glisser-déposer dans l'arbre du gestionnaire).
     */
    @Post("move")
    public async move(request: Request): Promise<ConnectionProfile> {
        const { id, folderId, index } = request.body as { id: string; folderId: string; index: number };
        return await this.connections.store.moveProfile(id, folderId, index);
    }

    // --- Étiquettes ---

    @Get("tags")
    public listTags(): ConnectionTagDef[] {
        return this.connections.store.listTags();
    }

    @Post("tag-create")
    public async createTag(request: Request): Promise<ConnectionTagDef> {
        const { input } = request.body as { input: ConnectionTagInput };
        return await this.connections.store.createTag(input);
    }

    @Post("tag-update")
    public async updateTag(request: Request): Promise<ConnectionTagDef> {
        const { id, input } = request.body as { id: string; input: ConnectionTagInput };
        return await this.connections.store.updateTag(id, input);
    }

    @Post("tag-delete")
    public async deleteTag(request: Request): Promise<void> {
        const { id } = request.body as { id: string };
        await this.connections.store.deleteTag(id);
    }

    // --- Dossiers ---

    @Get("folders")
    public listFolders(): ConnectionFolder[] {
        return this.connections.store.listFolders();
    }

    @Post("folder-create")
    public async createFolder(request: Request): Promise<ConnectionFolder> {
        const { input } = request.body as { input: ConnectionFolderInput };
        return await this.connections.store.createFolder(input);
    }

    @Post("folder-update")
    public async updateFolder(request: Request): Promise<ConnectionFolder> {
        const { id, input } = request.body as { id: string; input: ConnectionFolderInput };
        return await this.connections.store.updateFolder(id, input);
    }

    @Post("folder-delete")
    public async deleteFolder(request: Request): Promise<void> {
        const { id } = request.body as { id: string };
        await this.connections.store.deleteFolder(id);
    }

    @Post("connect")
    public async connect(request: Request): Promise<ConnectionConnectResult> {
        const { id } = request.body as { id: string };
        return await this.connections.connect(request.senderId, id);
    }

    @Post("import")
    public async import(request: Request): Promise<number> {
        const { passphrase } = request.body as { passphrase: string };
        return await this.connections.importProfiles(request.senderId, passphrase);
    }
}
