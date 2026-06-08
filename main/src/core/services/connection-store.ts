/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { app } from "electron/main";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionVaultStatus,
} from "@shared/connection";
import type { DatabaseDriverType } from "@shared/driver";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { decryptFromXml, encryptToXml } from "src/core/services/connection-crypto";

/** Profil complet tel que persisté (inclut le secret, jamais exposé au renderer). */
interface StoredProfile extends Omit<ConnectionProfile, "hasPassword"> {
    password?: string;
}

const PAYLOAD_ROOT = "connections";

const payloadParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    isArray: (name) => name === "connection",
});
const payloadBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

/**
 * Coffre des profils de connexion sauvegardés.
 *
 * Persiste les profils (identifiants inclus) dans un fichier XML chiffré par une
 * clé dérivée d'un mot de passe maître. Le coffre démarre verrouillé : il doit
 * être déverrouillé une fois par session avant tout accès aux profils.
 * Permet aussi d'exporter/importer des profils via des fichiers XML chiffrés par
 * une passphrase indépendante, pour partager l'accès à une base.
 */
export class ConnectionStore {
    private readonly filePath: string;
    private masterPassword: string | null = null;
    private profiles: StoredProfile[] = [];
    private unlocked = false;

    public constructor() {
        this.filePath = join(app.getPath("userData"), "connections.xml");
    }

    /**
     * Retourne l'état courant du coffre.
     */
    public getStatus(): ConnectionVaultStatus {
        return { initialized: existsSync(this.filePath), unlocked: this.unlocked };
    }

    /**
     * Initialise un nouveau coffre vide protégé par un mot de passe maître.
     * @throws Si un coffre existe déjà.
     */
    public initialize(masterPassword: string): void {
        if (existsSync(this.filePath)) {
            throw new Error("Connection vault already initialized");
        }
        if (!masterPassword) {
            throw new Error("Master password cannot be empty");
        }

        this.masterPassword = masterPassword;
        this.profiles = [];
        this.unlocked = true;
        this.save();
    }

    /**
     * Déverrouille le coffre avec le mot de passe maître.
     * @returns `true` si le déverrouillage réussit, `false` si le mot de passe est incorrect.
     */
    public unlock(masterPassword: string): boolean {
        if (!existsSync(this.filePath)) {
            return false;
        }

        try {
            const xml = readFileSync(this.filePath, "utf-8");
            const plaintext = decryptFromXml(xml, masterPassword);
            this.profiles = this.parseProfiles(plaintext);
            this.masterPassword = masterPassword;
            this.unlocked = true;
            return true;
        }
        catch {
            // Échec de déchiffrement = mauvais mot de passe (ou fichier corrompu).
            this.masterPassword = null;
            this.profiles = [];
            this.unlocked = false;
            return false;
        }
    }

    /**
     * Verrouille le coffre et purge les secrets de la mémoire.
     */
    public lock(): void {
        this.masterPassword = null;
        this.profiles = [];
        this.unlocked = false;
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
    public create(input: ConnectionProfileInput): ConnectionProfile {
        this.ensureUnlocked();

        const now = Date.now();
        const profile: StoredProfile = {
            ...this.normalizeInput(input),
            id: randomUUID(),
            password: input.password ?? "",
            createdAt: now,
            updatedAt: now,
        };

        this.profiles.push(profile);
        this.save();
        return this.toPublic(profile);
    }

    /**
     * Met à jour un profil existant. Un `password` absent (`undefined`) laisse
     * le secret inchangé ; une chaîne vide supprime le mot de passe.
     * @throws Si le profil n'existe pas.
     */
    public update(id: string, input: ConnectionProfileInput): ConnectionProfile {
        this.ensureUnlocked();

        const existing = this.profiles.find(p => p.id === id);
        if (!existing) {
            throw new Error(`Connection profile not found: ${id}`);
        }

        const updated: StoredProfile = {
            ...existing,
            ...this.normalizeInput(input),
            id: existing.id,
            password: input.password ?? existing.password,
            createdAt: existing.createdAt,
            updatedAt: Date.now(),
        };

        this.profiles = this.profiles.map(p => (p.id === id ? updated : p));
        this.save();
        return this.toPublic(updated);
    }

    /**
     * Supprime un profil.
     */
    public delete(id: string): void {
        this.ensureUnlocked();
        this.profiles = this.profiles.filter(p => p.id !== id);
        this.save();
    }

    /**
     * Récupère le profil complet (secret inclus) pour établir une connexion.
     * Usage interne au main uniquement.
     */
    public getProfile(id: string): StoredProfile | null {
        this.ensureUnlocked();
        return this.profiles.find(p => p.id === id) ?? null;
    }

    /**
     * Exporte les profils sélectionnés dans un document XML chiffré par `passphrase`.
     * Le chiffrement est indépendant du mot de passe maître pour permettre le partage.
     */
    public exportProfiles(ids: string[], passphrase: string): string {
        this.ensureUnlocked();
        if (!passphrase) {
            throw new Error("Passphrase cannot be empty");
        }

        const selected = this.profiles.filter(p => ids.includes(p.id));
        const plaintext = this.serializeProfiles(selected);
        return encryptToXml(plaintext, passphrase);
    }

    /**
     * Importe des profils depuis un document XML chiffré par `passphrase`.
     * Chaque profil importé reçoit un nouvel identifiant et est re-chiffré sous
     * le mot de passe maître du coffre local.
     * @returns Le nombre de profils importés.
     * @throws Si la passphrase est incorrecte.
     */
    public importProfiles(xml: string, passphrase: string): number {
        this.ensureUnlocked();

        const plaintext = decryptFromXml(xml, passphrase);
        const imported = this.parseProfiles(plaintext);
        const now = Date.now();

        for (const profile of imported) {
            this.profiles.push({ ...profile, id: randomUUID(), createdAt: now, updatedAt: now });
        }

        this.save();
        return imported.length;
    }

    // --- Helpers privés ---

    private ensureUnlocked(): void {
        if (!this.unlocked || this.masterPassword === null) {
            throw new Error("Connection vault is locked");
        }
    }

    /**
     * Convertit un profil stocké en version publique (sans secret).
     */
    private toPublic(profile: StoredProfile): ConnectionProfile {
        const { password, ...rest } = profile;
        return { ...rest, hasPassword: !!password };
    }

    /**
     * Filtre les champs d'entrée selon le mode de connexion pour éviter de
     * persister des champs incohérents (ex: host sur une connexion fichier).
     */
    private normalizeInput(input: ConnectionProfileInput): Omit<StoredProfile, "id" | "password" | "createdAt" | "updatedAt"> {
        const base = {
            name: input.name,
            color: input.color,
            driverType: input.driverType,
            connectionType: input.connectionType,
        };

        if (input.connectionType === "file") {
            return { ...base, filePath: input.filePath };
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
        };
    }

    /**
     * Sérialise une liste de profils en XML clair (avant chiffrement).
     */
    private serializeProfiles(profiles: StoredProfile[]): string {
        const payload = {
            [PAYLOAD_ROOT]: {
                "@_version": "1",
                connection: profiles.map(p => this.profileToXmlNode(p)),
            },
        };
        return payloadBuilder.build(payload);
    }

    /**
     * Transforme un profil en nœud XML (attributs uniquement, champs vides omis).
     */
    private profileToXmlNode(profile: StoredProfile): Record<string, string> {
        const node: Record<string, string> = {
            "@_id": profile.id,
            "@_name": profile.name,
            "@_driverType": profile.driverType,
            "@_connectionType": profile.connectionType,
            "@_createdAt": String(profile.createdAt),
            "@_updatedAt": String(profile.updatedAt),
        };

        const optional: Record<string, string | number | undefined> = {
            "@_color": profile.color,
            "@_filePath": profile.filePath,
            "@_host": profile.host,
            "@_port": profile.port,
            "@_username": profile.username,
            "@_database": profile.database,
            "@_authMode": profile.authMode,
            "@_clientId": profile.clientId,
            "@_tenantId": profile.tenantId,
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
     * Parse un XML clair de profils en objets `StoredProfile`.
     */
    private parseProfiles(xml: string): StoredProfile[] {
        const parsed = payloadParser.parse(xml) as Record<string, unknown>;
        const root = parsed[PAYLOAD_ROOT] as { connection?: Record<string, string>[] } | undefined;
        const nodes = root?.connection ?? [];

        return nodes.map(node => {
            const portRaw = node["@_port"];
            const profile: StoredProfile = {
                id: node["@_id"] ?? randomUUID(),
                name: node["@_name"] ?? "",
                driverType: (node["@_driverType"] ?? "sqlite") as DatabaseDriverType,
                connectionType: node["@_connectionType"] === "network" ? "network" : "file",
                createdAt: Number(node["@_createdAt"]) || Date.now(),
                updatedAt: Number(node["@_updatedAt"]) || Date.now(),
            };

            if (node["@_color"] !== undefined) {
                profile.color = String(node["@_color"]);
            }
            if (node["@_filePath"] !== undefined) {
                profile.filePath = String(node["@_filePath"]);
            }
            if (node["@_host"] !== undefined) {
                profile.host = String(node["@_host"]);
            }
            if (portRaw !== undefined) {
                profile.port = Number(portRaw);
            }
            if (node["@_username"] !== undefined) {
                profile.username = String(node["@_username"]);
            }
            if (node["@_database"] !== undefined) {
                profile.database = String(node["@_database"]);
            }
            if (node["@_authMode"] === "service-principal" || node["@_authMode"] === "sql") {
                profile.authMode = node["@_authMode"];
            }
            if (node["@_clientId"] !== undefined) {
                profile.clientId = String(node["@_clientId"]);
            }
            if (node["@_tenantId"] !== undefined) {
                profile.tenantId = String(node["@_tenantId"]);
            }
            if (node["@_password"] !== undefined) {
                profile.password = String(node["@_password"]);
            }

            return profile;
        });
    }

    /**
     * Chiffre et écrit le coffre sur le disque.
     */
    private save(): void {
        if (this.masterPassword === null) {
            throw new Error("Cannot save a locked vault");
        }

        const plaintext = this.serializeProfiles(this.profiles);
        const encrypted = encryptToXml(plaintext, this.masterPassword);
        writeFileSync(this.filePath, encrypted, "utf-8");
    }
}
