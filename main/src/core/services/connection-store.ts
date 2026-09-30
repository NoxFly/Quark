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

import { app } from "electron/main";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
    ConnectionFolder,
    ConnectionFolderInput,
    ConnectionMasterPasswordBody,
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionTagDef,
    ConnectionTagInput,
    ConnectionVaultStatus,
    SqliteSourceMode,
} from "@shared/connection";
import type { DatabaseDriverType } from "@shared/driver";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { decryptFromXml, encryptToXml } from "src/core/services/connection-crypto";
import type { StoredConnectionProfile } from "src/core/services/connection-store.types";
import { electronKeychain } from "src/core/services/system-keychain";
import type { SystemKeychain } from "src/core/services/system-keychain.types";

const PAYLOAD_ROOT = "connections";

/**
 * Version du contenu déchiffré. La 2 ajoute les dossiers et les champs de profil
 * (source SQLite, URI, SSL, étiquette, notes…), la 3 les étiquettes personnalisables
 * et l'ordre des profils. Les versions antérieures se lisent sans perte, les champs
 * absents prenant leur valeur par défaut.
 */
const PAYLOAD_VERSION = "3";

/** Première version où le coffre contient ses étiquettes. */
const TAGS_PAYLOAD_VERSION = 3;

/** Nom du dossier créé pour un coffre qui n'en a aucun (coffre antérieur aux dossiers). */
const DEFAULT_FOLDER_NAME = "Connexions";

/**
 * Étiquettes créées dans un coffre neuf, ou antérieur aux étiquettes
 * personnalisables : leur couleur suit le thème tant qu'elle n'est pas changée.
 */
const BUILTIN_TAGS: readonly ConnectionTagDef[] = [
    { id: "production", order: 0 },
    { id: "client", order: 1 },
    { id: "local", order: 2 },
    { id: "other", order: 3 },
];

const TAG_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** Longueur de la clé aléatoire qui remplace le mot de passe maître quand il est désactivé. */
const KEYCHAIN_SECRET_BYTES = 32;

const payloadParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    isArray: (name) => name === "connection" || name === "folder" || name === "tag",
});
// `suppressBooleanAttributes` écrirait `ssl="true"` en attribut nu (`ssl`), que le
// parseur ignore : l'option serait perdue à la relecture.
const payloadBuilder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressBooleanAttributes: false,
});

/** Contenu déchiffré du coffre (ou d'un export). */
interface VaultPayload {
    folders: ConnectionFolder[];
    tags: ConnectionTagDef[];
    profiles: StoredConnectionProfile[];
}

/** Contenu relu, avec la version du format qui l'a écrit. */
interface ParsedVaultPayload extends VaultPayload {
    version: number;
}

/**
 * Coffre des profils de connexion sauvegardés.
 *
 * Persiste les profils (identifiants inclus) et leurs dossiers dans un fichier XML
 * chiffré. La clé est dérivée soit d'un mot de passe maître saisi une fois par
 * session, soit — mot de passe maître désactivé — d'un secret aléatoire lui-même
 * protégé par le trousseau du système (`connections.key`) : le coffre se
 * déverrouille alors seul. Permet aussi d'exporter/importer des profils via des
 * fichiers XML chiffrés par une passphrase indépendante, pour partager l'accès à
 * une base.
 */
export class ConnectionStore {
    private readonly filePath: string;
    private readonly keyFilePath: string;
    private masterPassword: string | null = null;
    private profiles: StoredConnectionProfile[] = [];
    private folders: ConnectionFolder[] = [];
    private tags: ConnectionTagDef[] = [];
    private unlocked = false;
    private pendingSave: Promise<void> = Promise.resolve();

    /**
     * @param keychain - Trousseau du système (factice dans les tests).
     */
    public constructor(private readonly keychain: SystemKeychain = electronKeychain) {
        const directory = app.getPath("userData");
        this.filePath = join(directory, "connections.xml");
        this.keyFilePath = join(directory, "connections.key");
    }

    /**
     * Retourne l'état courant du coffre. Sans mot de passe maître, le coffre est
     * déverrouillé au passage par le trousseau : c'est la première chose que
     * demande le renderer.
     */
    public async getStatus(): Promise<ConnectionVaultStatus> {
        const initialized = existsSync(this.filePath);
        const masterPasswordEnabled = !existsSync(this.keyFilePath);

        if (initialized && !masterPasswordEnabled && !this.unlocked) {
            await this.unlockWithKeychain();
        }

        return {
            initialized,
            unlocked: this.unlocked,
            // Relu : un secret périmé a pu être supprimé par la tentative ci-dessus.
            masterPasswordEnabled: !existsSync(this.keyFilePath),
        };
    }

    /** Le coffre est déverrouillé pour la session (lecture sans effet de bord). */
    public get isUnlocked(): boolean {
        return this.unlocked;
    }

    /**
     * Initialise un nouveau coffre vide protégé par un mot de passe maître.
     * @throws Si un coffre existe déjà.
     */
    public async initialize(masterPassword: string): Promise<void> {
        if (existsSync(this.filePath)) {
            throw new Error("Connection vault already initialized");
        }
        if (!masterPassword) {
            throw new Error("Master password cannot be empty");
        }

        await this.removeKeyFile();
        this.openEmpty(masterPassword);
        await this.save();
    }

    /**
     * Déverrouille le coffre avec le mot de passe maître. Sans mot de passe
     * maître, le trousseau du système suffit et `masterPassword` est ignoré.
     * @returns `true` si le déverrouillage réussit, `false` si le mot de passe est incorrect.
     */
    public async unlock(masterPassword: string): Promise<boolean> {
        if (!existsSync(this.filePath)) {
            return false;
        }

        if (existsSync(this.keyFilePath) && await this.unlockWithKeychain()) {
            return true;
        }

        return await this.unlockWith(masterPassword);
    }

    /**
     * Verrouille le coffre et purge les secrets de la mémoire.
     */
    public lock(): void {
        this.masterPassword = null;
        this.profiles = [];
        this.folders = [];
        this.tags = [];
        this.unlocked = false;
    }

    /**
     * Active ou désactive le mot de passe maître.
     *
     * - activer : le coffre est rechiffré avec le nouveau mot de passe, puis le
     *   secret du trousseau est supprimé (même effet qu'un changement de mot de passe
     *   quand il était déjà actif) ;
     * - désactiver : le mot de passe actuel est vérifié, puis le coffre est rechiffré
     *   avec un secret aléatoire confié au trousseau du système.
     *
     * @throws Si le mot de passe est vide ou incorrect, si le coffre est verrouillé,
     * ou si le trousseau du système est indisponible (désactivation).
     */
    public async setMasterPassword(body: ConnectionMasterPasswordBody): Promise<void> {
        if (body.enabled) {
            await this.enableMasterPassword(body.masterPassword);
        }
        else {
            await this.disableMasterPassword(body.masterPassword);
        }
    }

    /**
     * Liste les profils sans leur secret.
     */
    public list(): ConnectionProfile[] {
        this.ensureUnlocked();
        return this.profiles.map(p => this.toPublic(p));
    }

    /**
     * Crée un nouveau profil et retourne sa version publique.
     */
    public async create(input: ConnectionProfileInput): Promise<ConnectionProfile> {
        this.ensureUnlocked();

        const now = Date.now();
        const normalized = this.normalizeInput(input);
        const profile: StoredConnectionProfile = {
            ...normalized,
            id: randomUUID(),
            password: input.password ?? "",
            order: this.nextProfileOrder(normalized.folderId),
            createdAt: now,
            updatedAt: now,
        };

        this.profiles.push(profile);
        await this.save();
        return this.toPublic(profile);
    }

    /**
     * Met à jour un profil existant. Un `password` absent (`undefined`) laisse
     * le secret inchangé ; une chaîne vide supprime le mot de passe.
     * @throws Si le profil n'existe pas.
     */
    public async update(id: string, input: ConnectionProfileInput): Promise<ConnectionProfile> {
        this.ensureUnlocked();

        const existing = this.requireProfile(id);
        const normalized = this.normalizeInput(input);
        // Un profil changé de dossier y prend la dernière place.
        const order = normalized.folderId === existing.folderId ? existing.order : this.nextProfileOrder(normalized.folderId);

        const updated: StoredConnectionProfile = {
            ...existing,
            ...normalized,
            id: existing.id,
            order,
            password: input.password ?? existing.password,
            createdAt: existing.createdAt,
            updatedAt: Date.now(),
            lastConnectedAt: existing.lastConnectedAt,
        };

        this.profiles = this.profiles.map(p => (p.id === id ? updated : p));
        await this.save();
        return this.toPublic(updated);
    }

    /**
     * Supprime un profil.
     */
    public async delete(id: string): Promise<void> {
        this.ensureUnlocked();
        this.profiles = this.profiles.filter(p => p.id !== id);
        await this.save();
    }

    /**
     * Récupère le profil complet (secret inclus) pour établir une connexion.
     * Usage interne au main uniquement.
     */
    public getProfile(id: string): StoredConnectionProfile | null {
        this.ensureUnlocked();
        return this.profiles.find(p => p.id === id) ?? null;
    }

    /**
     * Date la dernière connexion réussie à un profil (tri « récents » du gestionnaire).
     * Sans effet sur `updatedAt` : se connecter ne modifie pas le profil.
     */
    public async markConnected(id: string): Promise<void> {
        this.ensureUnlocked();

        const profile = this.requireProfile(id);
        profile.lastConnectedAt = Date.now();
        await this.save();
    }

    /**
     * Déplace un profil dans un dossier, à la position donnée : les profils de ce
     * dossier sont renumérotés dans l'ordre qui en résulte.
     * @param id - Profil déplacé.
     * @param folderId - Dossier d'arrivée.
     * @param index - Position d'arrivée parmi les autres profils de ce dossier
     * (bornée à la fin du dossier).
     * @throws Si le profil ou le dossier n'existe pas.
     */
    public async moveProfile(id: string, folderId: string, index: number): Promise<ConnectionProfile> {
        this.ensureUnlocked();

        const profile = this.requireProfile(id);

        if (!this.folders.some(f => f.id === folderId)) {
            throw new Error(`Connection folder not found: ${folderId}`);
        }

        const siblings = this.profilesInFolder(folderId).filter(p => p.id !== id);
        siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, profile);

        profile.folderId = folderId;
        siblings.forEach((sibling, position) => {
            sibling.order = position;
        });

        await this.save();
        return this.toPublic(profile);
    }

    // --- Étiquettes ---

    /**
     * Liste les étiquettes, dans leur ordre d'affichage.
     */
    public listTags(): ConnectionTagDef[] {
        this.ensureUnlocked();
        return [...this.tags].sort((a, b) => a.order - b.order).map(tag => ({ ...tag }));
    }

    /**
     * Crée une étiquette, placée après les autres.
     * @throws Si le nom est vide ou la couleur invalide.
     */
    public async createTag(input: ConnectionTagInput): Promise<ConnectionTagDef> {
        this.ensureUnlocked();

        const name = input.name?.trim() ?? "";

        if (!name) {
            throw new Error("Tag name cannot be empty");
        }

        const tag: ConnectionTagDef = {
            id: randomUUID(),
            name,
            order: this.tags.reduce((max, current) => Math.max(max, current.order), -1) + 1,
        };
        const color = this.requireTagColor(input.color);

        if (color) {
            tag.color = color;
        }

        this.tags.push(tag);
        await this.save();
        return { ...tag };
    }

    /**
     * Renomme ou recolore une étiquette. Un champ absent reste inchangé ; un nom
     * vide rend à une étiquette fournie son nom traduit, une couleur vide sa
     * couleur de thème.
     * @throws Si l'étiquette n'existe pas, si le nom d'une étiquette créée est
     * vidé, ou si la couleur est invalide.
     */
    public async updateTag(id: string, input: ConnectionTagInput): Promise<ConnectionTagDef> {
        this.ensureUnlocked();

        const tag = this.tags.find(t => t.id === id);

        if (!tag) {
            throw new Error(`Connection tag not found: ${id}`);
        }

        if (input.name !== undefined) {
            const name = input.name.trim();

            if (!name && !isBuiltinTag(id)) {
                throw new Error("Tag name cannot be empty");
            }

            if (name) {
                tag.name = name;
            }
            else {
                delete tag.name;
            }
        }

        if (input.color !== undefined) {
            const color = this.requireTagColor(input.color);

            if (color) {
                tag.color = color;
            }
            else {
                delete tag.color;
            }
        }

        await this.save();
        return { ...tag };
    }

    /**
     * Supprime une étiquette ; les profils qui la portaient n'en ont plus.
     * @throws Si l'étiquette n'existe pas.
     */
    public async deleteTag(id: string): Promise<void> {
        this.ensureUnlocked();

        if (!this.tags.some(t => t.id === id)) {
            throw new Error(`Connection tag not found: ${id}`);
        }

        this.tags = this.tags.filter(t => t.id !== id);

        for (const profile of this.profiles) {
            if (profile.tag === id) {
                delete profile.tag;
            }
        }

        await this.save();
    }

    // --- Dossiers ---

    /**
     * Liste les dossiers, dans leur ordre d'affichage.
     */
    public listFolders(): ConnectionFolder[] {
        this.ensureUnlocked();
        return this.sortedFolders().map(folder => ({ ...folder }));
    }

    /**
     * Crée un dossier, placé après les autres.
     * @throws Si le nom est vide.
     */
    public async createFolder(input: ConnectionFolderInput): Promise<ConnectionFolder> {
        this.ensureUnlocked();

        const folder: ConnectionFolder = {
            id: randomUUID(),
            name: this.requireFolderName(input),
            order: this.folders.reduce((max, current) => Math.max(max, current.order), -1) + 1,
        };

        this.folders.push(folder);
        await this.save();
        return { ...folder };
    }

    /**
     * Renomme un dossier.
     * @throws Si le dossier n'existe pas ou si le nom est vide.
     */
    public async updateFolder(id: string, input: ConnectionFolderInput): Promise<ConnectionFolder> {
        this.ensureUnlocked();

        const folder = this.folders.find(f => f.id === id);

        if (!folder) {
            throw new Error(`Connection folder not found: ${id}`);
        }

        folder.name = this.requireFolderName(input);
        await this.save();
        return { ...folder };
    }

    /**
     * Supprime un dossier ; ses profils rejoignent le premier dossier restant.
     * @throws Si le dossier n'existe pas, ou s'il est le dernier : un profil doit
     * toujours avoir un dossier où s'afficher.
     */
    public async deleteFolder(id: string): Promise<void> {
        this.ensureUnlocked();

        if (!this.folders.some(f => f.id === id)) {
            throw new Error(`Connection folder not found: ${id}`);
        }

        const [target] = this.sortedFolders().filter(f => f.id !== id);

        if (!target) {
            throw new Error("The last connection folder cannot be deleted");
        }

        this.folders = this.folders.filter(f => f.id !== id);

        for (const profile of this.profiles) {
            if (profile.folderId === id) {
                profile.folderId = target.id;
            }
        }

        await this.save();
    }

    // --- Export / import ---

    /**
     * Exporte les profils sélectionnés dans un document XML chiffré par `passphrase`.
     * Les dossiers des profils exportés les accompagnent.
     *
     * L'interface ne propose plus d'export (le partage d'une base passe par un
     * fichier `.quarkshare`) : cette méthode reste la définition du format que
     * lit `importProfiles`, pour les fichiers déjà produits.
     */
    public async exportProfiles(ids: string[], passphrase: string): Promise<string> {
        this.ensureUnlocked();
        if (!passphrase) {
            throw new Error("Passphrase cannot be empty");
        }

        const selected = this.profiles.filter(p => ids.includes(p.id));
        const folderIds = new Set(selected.map(p => p.folderId));
        const folders = this.folders.filter(f => folderIds.has(f.id));
        // `lastConnectedAt` décrit l'usage local, pas la connexion partagée.
        const exported = selected.map(({ lastConnectedAt: _lastConnectedAt, ...profile }) => profile);

        return await encryptToXml(this.serializePayload({ folders, tags: [], profiles: exported }), passphrase);
    }

    /**
     * Importe des profils depuis un document XML chiffré par `passphrase`.
     * Chaque profil importé reçoit un nouvel identifiant et est re-chiffré sous
     * la clé du coffre local. Un dossier importé rejoint le dossier local du même
     * nom, ou est créé.
     * @returns Le nombre de profils importés.
     * @throws Si la passphrase est incorrecte.
     */
    public async importProfiles(xml: string, passphrase: string): Promise<number> {
        this.ensureUnlocked();

        const plaintext = await decryptFromXml(xml, passphrase);
        const imported = this.parsePayload(plaintext);
        const folderMapping = this.mergeImportedFolders(imported.folders);
        const now = Date.now();

        for (const profile of imported.profiles) {
            const folderId = profile.folderId ? folderMapping.get(profile.folderId) : undefined;

            this.profiles.push({
                ...profile,
                id: randomUUID(),
                folderId,
                // L'étiquette n'est gardée que si ce coffre en possède une du même identifiant.
                tag: profile.tag && this.tags.some(t => t.id === profile.tag) ? profile.tag : undefined,
                order: this.nextProfileOrder(folderId),
                createdAt: now,
                updatedAt: now,
                lastConnectedAt: undefined,
            });
        }

        await this.save();
        return imported.profiles.length;
    }

    // --- Helpers privés ---

    private ensureUnlocked(): void {
        if (!this.unlocked || this.masterPassword === null) {
            throw new Error("Connection vault is locked");
        }
    }

    private requireProfile(id: string): StoredConnectionProfile {
        const profile = this.profiles.find(p => p.id === id);

        if (!profile) {
            throw new Error(`Connection profile not found: ${id}`);
        }

        return profile;
    }

    private requireFolderName(input: ConnectionFolderInput): string {
        const name = input.name?.trim() ?? "";

        if (!name) {
            throw new Error("Folder name cannot be empty");
        }

        return name;
    }

    private sortedFolders(): ConnectionFolder[] {
        return [...this.folders].sort((a, b) => a.order - b.order);
    }

    /**
     * Profils d'un dossier dans leur ordre d'affichage : position fixée d'abord,
     * puis ordre alphabétique pour ceux qui n'en ont pas.
     */
    private profilesInFolder(folderId: string | undefined): StoredConnectionProfile[] {
        return this.profiles
            .filter(p => p.folderId === folderId)
            .sort(compareProfileOrder);
    }

    /**
     * Position d'un profil ajouté en fin de dossier.
     */
    private nextProfileOrder(folderId: string | undefined): number {
        return this.profilesInFolder(folderId).reduce((max, p) => Math.max(max, p.order ?? -1), -1) + 1;
    }

    /**
     * Valide une couleur d'étiquette.
     * @returns La couleur en minuscules, ou `undefined` pour une couleur vide.
     * @throws Si la couleur n'est pas au format `#rrggbb`.
     */
    private requireTagColor(color: string | undefined): string | undefined {
        if (color === undefined || color === "") {
            return undefined;
        }

        if (!TAG_COLOR_PATTERN.test(color)) {
            throw new Error(`Invalid tag color: ${color}`);
        }

        return color.toLowerCase();
    }

    /**
     * Associe chaque dossier importé à un dossier local : celui du même nom s'il
     * existe, sinon un nouveau dossier ajouté à la fin.
     * @returns Identifiant importé → identifiant local.
     */
    private mergeImportedFolders(imported: ConnectionFolder[]): Map<string, string> {
        const mapping = new Map<string, string>();
        let nextOrder = this.folders.reduce((max, current) => Math.max(max, current.order), -1) + 1;

        for (const folder of imported) {
            const existing = this.folders.find(f => f.name.toLowerCase() === folder.name.toLowerCase());

            if (existing) {
                mapping.set(folder.id, existing.id);
                continue;
            }

            const created: ConnectionFolder = { id: randomUUID(), name: folder.name, order: nextOrder++ };
            this.folders.push(created);
            mapping.set(folder.id, created.id);
        }

        return mapping;
    }

    /**
     * Charge un coffre vide en mémoire, déverrouillé sous `secret`.
     */
    private openEmpty(secret: string): void {
        this.masterPassword = secret;
        this.profiles = [];
        this.folders = [];
        this.tags = BUILTIN_TAGS.map(tag => ({ ...tag }));
        this.ensureDefaultFolder();
        this.unlocked = true;
    }

    /**
     * Garantit qu'au moins un dossier existe : un coffre antérieur aux dossiers,
     * ou dont tous les dossiers ont disparu, reçoit un dossier par défaut.
     * @returns `true` si un dossier a été créé.
     */
    private ensureDefaultFolder(): boolean {
        if (this.folders.length > 0) {
            return false;
        }

        this.folders = [{ id: randomUUID(), name: DEFAULT_FOLDER_NAME, order: 0 }];
        return true;
    }

    /**
     * Déchiffre le coffre avec `secret` et le charge en mémoire.
     * @returns `false` si le secret est incorrect (ou le fichier corrompu).
     */
    private async unlockWith(secret: string): Promise<boolean> {
        let upgraded = false;

        try {
            const xml = await readFile(this.filePath, "utf-8");
            const payload = this.parsePayload(await decryptFromXml(xml, secret));

            // Un coffre antérieur aux étiquettes personnalisables reçoit celles de
            // l'application ; un coffre récent sans étiquette les a toutes supprimées.
            upgraded = payload.version < TAGS_PAYLOAD_VERSION;

            this.masterPassword = secret;
            this.profiles = payload.profiles;
            this.folders = payload.folders;
            this.tags = upgraded ? BUILTIN_TAGS.map(tag => ({ ...tag })) : payload.tags;
            this.unlocked = true;
        }
        catch {
            // Échec de déchiffrement = mauvais mot de passe (ou fichier corrompu).
            this.lock();
            return false;
        }

        // Écrit aussitôt le dossier par défaut et les étiquettes : leurs identifiants
        // doivent rester stables d'une session à l'autre, les profils s'y référant.
        if (this.ensureDefaultFolder() || upgraded) {
            await this.save();
        }

        return true;
    }

    /**
     * Déverrouille le coffre par le secret confié au trousseau du système.
     *
     * Un secret que le trousseau déchiffre mais qui n'ouvre pas le coffre est
     * périmé (interruption pendant une réactivation du mot de passe maître) : il est
     * supprimé, et le coffre redevient protégé par son mot de passe maître.
     */
    private async unlockWithKeychain(): Promise<boolean> {
        const secret = await this.readKeychainSecret();

        if (secret === null) {
            return false;
        }

        if (await this.unlockWith(secret)) {
            return true;
        }

        await this.removeKeyFile();
        return false;
    }

    private async readKeychainSecret(): Promise<string | null> {
        if (!existsSync(this.keyFilePath) || !this.keychain.isAvailable()) {
            return null;
        }

        try {
            return this.keychain.decrypt(await readFile(this.keyFilePath));
        }
        catch {
            return null;
        }
    }

    private async enableMasterPassword(masterPassword: string): Promise<void> {
        if (!masterPassword) {
            throw new Error("Master password cannot be empty");
        }

        if (!existsSync(this.filePath)) {
            await this.initialize(masterPassword);
            return;
        }

        if (!this.unlocked && existsSync(this.keyFilePath)) {
            await this.unlockWithKeychain();
        }

        this.ensureUnlocked();

        // Le coffre est rechiffré avant la suppression du secret : interrompu entre
        // les deux, il reste ouvrable par le nouveau mot de passe, et le secret
        // devenu périmé est écarté à la prochaine lecture.
        this.masterPassword = masterPassword;
        await this.save();
        await this.removeKeyFile();
    }

    private async disableMasterPassword(currentPassword: string): Promise<void> {
        if (!this.keychain.isAvailable()) {
            throw new Error("The system keychain is not available on this computer: the master password cannot be disabled.");
        }

        if (existsSync(this.keyFilePath)) {
            return;
        }

        const secret = randomBytes(KEYCHAIN_SECRET_BYTES).toString("base64");

        if (!existsSync(this.filePath)) {
            await this.writeKeyFile(secret);
            this.openEmpty(secret);
            await this.save();
            return;
        }

        if (!currentPassword || !(await this.unlockWith(currentPassword))) {
            throw new Error("Invalid master password");
        }

        // Le secret est écrit avant le rechiffrement : dans l'ordre inverse, une
        // interruption laisserait un coffre chiffré par une clé perdue.
        await this.writeKeyFile(secret);

        try {
            this.masterPassword = secret;
            await this.save();
        }
        catch (error) {
            this.masterPassword = currentPassword;
            await this.removeKeyFile();
            throw error;
        }
    }

    private async writeKeyFile(secret: string): Promise<void> {
        await writeFile(this.keyFilePath, this.keychain.encrypt(secret), { mode: 0o600 });
    }

    private async removeKeyFile(): Promise<void> {
        await rm(this.keyFilePath, { force: true });
    }

    /**
     * Convertit un profil stocké en version publique (sans secret).
     */
    private toPublic(profile: StoredConnectionProfile): ConnectionProfile {
        const { password, ...rest } = profile;
        return { ...rest, hasPassword: !!password };
    }

    /**
     * Filtre les champs d'entrée selon le mode de connexion pour éviter de
     * persister des champs incohérents (ex: host sur une connexion fichier).
     */
    private normalizeInput(input: ConnectionProfileInput): Omit<StoredConnectionProfile, "id" | "password" | "createdAt" | "updatedAt"> {
        const base = {
            name: input.name,
            color: input.color,
            driverType: input.driverType,
            connectionType: input.connectionType,
            folderId: input.folderId || undefined,
            tag: input.tag && this.tags.some(t => t.id === input.tag) ? input.tag : undefined,
            notes: input.notes || undefined,
        };

        if (input.connectionType === "file") {
            if (input.sqliteMode === "url" || input.driverType === "libsql") {
                return { ...base, sqliteMode: "url", url: input.url?.trim() || undefined };
            }

            return { ...base, sqliteMode: input.sqliteMode ? "file" : undefined, filePath: input.filePath };
        }

        if (input.driverType === "libsql") {
            return { ...base, sqliteMode: "url", url: input.url?.trim() || undefined };
        }

        return {
            ...base,
            host: input.host,
            port: input.port,
            username: input.username,
            database: input.database,
            authMode: input.authMode,
            clientId: input.clientId,
            tenantId: input.tenantId,
            uri: input.driverType === "mongodb" ? input.uri?.trim() || undefined : undefined,
            ssl: input.ssl,
        };
    }

    /**
     * Sérialise dossiers et profils en XML clair (avant chiffrement).
     */
    private serializePayload(payload: VaultPayload): string {
        return payloadBuilder.build({
            [PAYLOAD_ROOT]: {
                "@_version": PAYLOAD_VERSION,
                folder: payload.folders.map(folder => ({
                    "@_id": folder.id,
                    "@_name": folder.name,
                    "@_order": String(folder.order),
                })),
                tag: payload.tags.map(tag => ({
                    "@_id": tag.id,
                    ...(tag.name ? { "@_name": tag.name } : {}),
                    ...(tag.color ? { "@_color": tag.color } : {}),
                    "@_order": String(tag.order),
                })),
                connection: payload.profiles.map(p => this.profileToXmlNode(p)),
            },
        });
    }

    /**
     * Transforme un profil en nœud XML (attributs uniquement, champs vides omis).
     */
    private profileToXmlNode(profile: StoredConnectionProfile): Record<string, string> {
        const node: Record<string, string> = {
            "@_id": profile.id,
            "@_name": profile.name,
            "@_driverType": profile.driverType,
            "@_connectionType": profile.connectionType,
            "@_createdAt": String(profile.createdAt),
            "@_updatedAt": String(profile.updatedAt),
        };

        const optional: Record<string, string | number | boolean | undefined> = {
            "@_color": profile.color,
            "@_filePath": profile.filePath,
            "@_host": profile.host,
            "@_port": profile.port,
            "@_username": profile.username,
            "@_database": profile.database,
            "@_authMode": profile.authMode,
            "@_clientId": profile.clientId,
            "@_tenantId": profile.tenantId,
            "@_sqliteMode": profile.sqliteMode,
            "@_url": profile.url,
            "@_uri": profile.uri,
            "@_ssl": profile.ssl,
            "@_folderId": profile.folderId,
            "@_tag": profile.tag,
            "@_order": profile.order,
            "@_notes": profile.notes,
            "@_lastConnectedAt": profile.lastConnectedAt,
            "@_password": profile.password,
        };

        for (const [key, value] of Object.entries(optional)) {
            if (value !== undefined && value !== "") {
                node[key] = String(value);
            }
        }

        return node;
    }

    /**
     * Parse un XML clair de dossiers et de profils. Accepte les deux versions du
     * format : un attribut absent laisse le champ à sa valeur par défaut.
     */
    private parsePayload(xml: string): ParsedVaultPayload {
        const parsed = payloadParser.parse(xml) as Record<string, unknown>;
        const root = parsed[PAYLOAD_ROOT] as {
            "@_version"?: string;
            connection?: Record<string, string>[];
            folder?: Record<string, string>[];
            tag?: Record<string, string>[];
        } | undefined;

        const folders = (root?.folder ?? [])
            .filter(node => node["@_id"] !== undefined)
            .map((node, index) => ({
                id: String(node["@_id"]),
                name: String(node["@_name"] ?? DEFAULT_FOLDER_NAME),
                order: Number.isFinite(Number(node["@_order"])) ? Number(node["@_order"]) : index,
            }));

        const tags = (root?.tag ?? [])
            .filter(node => node["@_id"] !== undefined)
            .map((node, index): ConnectionTagDef => {
                const color = node["@_color"];
                const tag: ConnectionTagDef = {
                    id: String(node["@_id"]),
                    order: Number.isFinite(Number(node["@_order"])) ? Number(node["@_order"]) : index,
                };

                if (node["@_name"]) {
                    tag.name = String(node["@_name"]);
                }

                if (color && TAG_COLOR_PATTERN.test(color)) {
                    tag.color = color;
                }

                return tag;
            });

        return {
            version: Number(root?.["@_version"]) || 1,
            folders,
            tags,
            profiles: (root?.connection ?? []).map(node => this.parseProfileNode(node)),
        };
    }

    private parseProfileNode(node: Record<string, string>): StoredConnectionProfile {
        const text = (key: string): string | undefined => (node[key] !== undefined ? String(node[key]) : undefined);
        const portRaw = node["@_port"];
        const authMode = node["@_authMode"];
        const sqliteMode = node["@_sqliteMode"];
        const orderRaw = node["@_order"];
        const lastConnectedAt = Number(node["@_lastConnectedAt"]);

        const profile: StoredConnectionProfile = {
            id: node["@_id"] ?? randomUUID(),
            name: node["@_name"] ?? "",
            driverType: (node["@_driverType"] ?? "sqlite") as DatabaseDriverType,
            connectionType: node["@_connectionType"] === "network" ? "network" : "file",
            createdAt: Number(node["@_createdAt"]) || Date.now(),
            updatedAt: Number(node["@_updatedAt"]) || Date.now(),
            color: text("@_color"),
            filePath: text("@_filePath"),
            host: text("@_host"),
            port: portRaw !== undefined ? Number(portRaw) : undefined,
            username: text("@_username"),
            database: text("@_database"),
            authMode: authMode === "service-principal" || authMode === "sql" ? authMode : undefined,
            clientId: text("@_clientId"),
            tenantId: text("@_tenantId"),
            sqliteMode: sqliteMode === "file" || sqliteMode === "url" ? sqliteMode as SqliteSourceMode : undefined,
            url: text("@_url"),
            uri: text("@_uri"),
            ssl: parseBoolean(node["@_ssl"]),
            folderId: text("@_folderId"),
            tag: text("@_tag"),
            order: orderRaw !== undefined && Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : undefined,
            notes: text("@_notes"),
            lastConnectedAt: lastConnectedAt > 0 ? lastConnectedAt : undefined,
            password: text("@_password"),
        };

        // Les clés absentes restent absentes : un profil relu est identique à
        // celui écrit, ce qui garde les comparaisons (et les tests) simples.
        const definedEntries = Object.entries(profile).filter(([, value]) => value !== undefined);

        return Object.fromEntries(definedEntries) as StoredConnectionProfile;
    }

    /**
     * Chiffre et écrit le coffre sur le disque.
     */
    private async save(): Promise<void> {
        if (this.masterPassword === null) {
            throw new Error("Cannot save a locked vault");
        }

        const plaintext = this.serializePayload({ folders: this.folders, tags: this.tags, profiles: this.profiles });
        const masterPassword = this.masterPassword;

        // Les sauvegardes sont sérialisées : deux écritures concurrentes du même
        // fichier pourraient laisser sur le disque l'état le plus ancien.
        const write = this.pendingSave.then(async () => {
            const encrypted = await encryptToXml(plaintext, masterPassword);
            await writeFile(this.filePath, encrypted, "utf-8");
        });

        this.pendingSave = write.catch(() => undefined);

        await write;
    }
}

/**
 * Lit un booléen sérialisé en attribut ; toute autre valeur vaut « non renseigné ».
 */
function parseBoolean(value: string | undefined): boolean | undefined {
    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return undefined;
}

function isBuiltinTag(id: string): boolean {
    return BUILTIN_TAGS.some(tag => tag.id === id);
}

/**
 * Ordre d'affichage de deux profils d'un même dossier : position fixée d'abord,
 * puis alphabétique.
 */
function compareProfileOrder(a: StoredConnectionProfile, b: StoredConnectionProfile): number {
    if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
    }

    if (a.order !== undefined) {
        return -1;
    }

    if (b.order !== undefined) {
        return 1;
    }

    return a.name.localeCompare(b.name);
}
