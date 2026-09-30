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

import type {
    BuiltinConnectionTagId,
    ConnectionFolder,
    ConnectionProfile,
    ConnectionProfileInput,
    ConnectionTagDef,
} from "@shared/connection";
import type { DatabaseDriverType, DriverInfo } from "@shared/driver";
import type { RecentDatabaseEntry } from "@shared/ipc-renderer";
import type { R_TestConnectionBody } from "@shared/types";
import type {
    ConnectionAddress,
    ConnectionDraft,
    ConnectionDraftDefaults,
    ConnectionFolderNode,
    LastConnectedLabels,
} from "src/app/core/models/connections.model";

/** Identifiant du dossier de repli affiché quand aucun dossier n'existe. */
export const UNFILED_FOLDER_ID = "__unfiled__";

/**
 * Couleurs proposées pour une étiquette. Fixes (non thémées) : une couleur choisie
 * doit rester la même d'un thème à l'autre, et lisible sur fond clair comme sombre.
 */
export const TAG_PALETTE: readonly string[] = [
    "#e5484d", "#f76b15", "#f5a524", "#46a758", "#12a594", "#0091ff",
    "#3e63dd", "#8e4ec6", "#d6409f", "#8d8d86", "#6e56cf", "#a18072",
];

/** Longueur minimale d'un mot de passe maître. */
export const MIN_MASTER_PASSWORD_LENGTH = 4;

/** Type proposé par défaut pour une nouvelle connexion. */
export const DEFAULT_DRAFT_DRIVER: DatabaseDriverType = "postgresql";

/** Couleur de thème d'une étiquette fournie, tant qu'elle n'est pas personnalisée. */
const BUILTIN_TAG_COLORS: Record<BuiltinConnectionTagId, string> = {
    production: "var(--danger)",
    client: "var(--warning)",
    local: "var(--success)",
    other: "var(--accent)",
};

/** Pastille d'un profil sans étiquette. */
const NO_TAG_COLOR = "var(--text-faint)";

const DRIVER_LOGOS: Record<DatabaseDriverType, string> = {
    sqlite: "images/logo-sqlite.png",
    libsql: "images/logo-sqlite.png",
    mysql: "images/logo-mysql-mariadb.png",
    postgresql: "images/logo-postgresql.png",
    oracle: "images/logo-oracle.png",
    mssql: "images/logo-mssql.png",
    azure: "images/logo-azure.png",
    mongodb: "images/logo-mongodb.png",
};

const DRIVER_MONOGRAMS: Record<DatabaseDriverType, string> = {
    sqlite: "SQ",
    libsql: "SQ",
    mysql: "My",
    postgresql: "Pg",
    oracle: "Or",
    mssql: "MS",
    azure: "Az",
    mongodb: "Mg",
};

const DAY_MS = 86_400_000;

/**
 * @description Trie les dossiers par ordre croissant puis par nom, sans muter l'entrée.
 * @param folders Dossiers renvoyés par le main.
 * @returns Une nouvelle liste triée.
 */
export function sortFolders(folders: readonly ConnectionFolder[]): ConnectionFolder[] {
    return [...folders].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * @description Range les profils dans leurs dossiers. Un profil sans dossier, ou dont le
 * dossier n'existe plus, rejoint le premier dossier ; sans aucun dossier, un nœud virtuel
 * (`UNFILED_FOLDER_ID`) les regroupe. Les profils sont triés par nom.
 * @param folders Dossiers (dans n'importe quel ordre).
 * @param profiles Profils du coffre.
 * @param unfiledName Nom affiché du nœud virtuel.
 * @returns L'arbre à afficher.
 * @example
 * groupProfilesByFolder([{ id: "f1", name: "Prod", order: 0 }], profiles, "Non classées");
 */
export function groupProfilesByFolder(
    folders: readonly ConnectionFolder[],
    profiles: readonly ConnectionProfile[],
    unfiledName: string,
): ConnectionFolderNode[] {
    const nodes: ConnectionFolderNode[] = sortFolders(folders).map(folder => ({
        id: folder.id,
        name: folder.name,
        profiles: [],
        virtual: false,
    }));

    if (nodes.length === 0) {
        if (profiles.length === 0) {
            return [];
        }

        nodes.push({ id: UNFILED_FOLDER_ID, name: unfiledName, profiles: [], virtual: true });
    }

    const byId = new Map(nodes.map(node => [node.id, node]));
    const fallback = nodes[0];

    for (const profile of profiles) {
        const target = (profile.folderId ? byId.get(profile.folderId) : undefined) ?? fallback;
        target?.profiles.push(profile);
    }

    for (const node of nodes) {
        node.profiles.sort(compareProfiles);
    }

    return nodes;
}

/**
 * @description Formate la date de dernière connexion : « Aujourd'hui 09:41 », « Hier 17:20 »,
 * une date complète, ou le libellé « Jamais ». La comparaison se fait par jour calendaire
 * local, pas par tranche de 24 h, pour que « Hier » corresponde au ressenti de l'utilisateur.
 * @param timestamp Horodatage en millisecondes (absent : jamais connecté).
 * @param now Instant de référence.
 * @param locale Locale d'affichage (`fr`, `en`).
 * @param labels Libellés traduits.
 * @returns Le texte à afficher.
 */
export function formatLastConnected(
    timestamp: number | undefined,
    now: Date,
    locale: string,
    labels: LastConnectedLabels,
): string {
    if (timestamp === undefined || !Number.isFinite(timestamp)) {
        return labels.never;
    }

    const date = new Date(timestamp);
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    // Arrondi : un changement d'heure (DST) décale d'une heure l'écart entre deux minuits.
    const daysAgo = Math.round((today - day) / DAY_MS);

    if (daysAgo === 0) {
        return `${labels.today} ${time}`;
    }

    if (daysAgo === 1) {
        return `${labels.yesterday} ${time}`;
    }

    const formattedDate = date.toLocaleDateString(locale);
    return `${formattedDate} ${time}`;
}

/**
 * @description Indique si un identifiant est celui d'une étiquette fournie par l'application.
 * @param id Identifiant d'étiquette.
 */
export function isBuiltinTagId(id: string): id is BuiltinConnectionTagId {
    return Object.hasOwn(BUILTIN_TAG_COLORS, id);
}

/**
 * @description Retrouve l'étiquette d'un profil.
 * @param tags Étiquettes du coffre.
 * @param id Identifiant porté par le profil.
 * @returns L'étiquette, ou `null` si le profil n'en a pas (ou plus).
 */
export function findTag(tags: readonly ConnectionTagDef[], id: string | undefined): ConnectionTagDef | null {
    return id ? tags.find(tag => tag.id === id) ?? null : null;
}

/**
 * @description Couleur de la pastille d'une étiquette : sa couleur personnalisée, ou le
 * token de thème d'une étiquette fournie.
 * @param tag Étiquette (absente : pastille neutre).
 * @returns Une couleur CSS.
 */
export function tagColor(tag: ConnectionTagDef | null): string {
    if (!tag) {
        return NO_TAG_COLOR;
    }

    return tag.color ?? (isBuiltinTagId(tag.id) ? BUILTIN_TAG_COLORS[tag.id] : NO_TAG_COLOR);
}

/**
 * @description Libellé d'une étiquette : son nom, ou le nom traduit d'une étiquette fournie.
 * @param tag Étiquette.
 * @param translate Traduction d'une clé i18n.
 */
export function tagLabel(tag: ConnectionTagDef, translate: (key: string) => string): string {
    return tag.name ?? (isBuiltinTagId(tag.id) ? translate(`connections.tag.${tag.id}`) : tag.id);
}

/**
 * @description Couleur de la pastille d'un profil : celle de son étiquette, ou la couleur
 * libre d'un ancien profil sans étiquette (champ `color` remplacé par l'étiquette).
 * @param profile Profil sauvegardé.
 * @param tags Étiquettes du coffre.
 * @returns Une couleur CSS.
 */
export function profileDotColor(profile: Pick<ConnectionProfile, "tag" | "color">, tags: readonly ConnectionTagDef[]): string {
    const tag = findTag(tags, profile.tag);

    if (!tag && profile.color) {
        return profile.color;
    }

    return tagColor(tag);
}

/**
 * @description Ordre d'affichage de deux profils d'un même dossier : position fixée par un
 * glisser-déposer d'abord, puis ordre alphabétique pour ceux qui n'en ont pas.
 */
export function compareProfiles(a: ConnectionProfile, b: ConnectionProfile): number {
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

/**
 * @description Applique localement un déplacement de profil, comme le fait le main : le
 * profil rejoint le dossier à la position donnée, et ce dossier est renuméroté.
 * @param profiles Profils du coffre.
 * @param id Profil déplacé.
 * @param folderId Dossier d'arrivée.
 * @param index Position parmi les autres profils de ce dossier (bornée).
 * @returns Une nouvelle liste ; l'entrée n'est pas modifiée.
 */
export function reorderProfiles(
    profiles: readonly ConnectionProfile[],
    id: string,
    folderId: string,
    index: number,
): ConnectionProfile[] {
    const moved = profiles.find(profile => profile.id === id);

    if (!moved) {
        return [...profiles];
    }

    const siblings = profiles
        .filter(profile => profile.folderId === folderId && profile.id !== id)
        .sort(compareProfiles);

    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, { ...moved, folderId });

    const positions = new Map(siblings.map((profile, position) => [profile.id, position]));

    return profiles.map(profile => {
        const order = positions.get(profile.id);
        return order === undefined ? profile : { ...profile, folderId, order };
    });
}

/**
 * @description Chemin du logo d'un driver (servi depuis `public/`).
 * @param type Type de driver.
 * @returns Le chemin de l'image, ou `null` pour un type inconnu.
 */
export function driverLogo(type: DatabaseDriverType): string | null {
    return DRIVER_LOGOS[type] ?? null;
}

/**
 * @description Monogramme de repli d'un driver (vignette sans logo).
 * @param type Type de driver.
 * @returns Deux lettres.
 */
export function driverMonogram(type: DatabaseDriverType): string {
    return DRIVER_MONOGRAMS[type] ?? type.slice(0, 2).toUpperCase();
}

/**
 * @description Indique si un profil désigne une base SQLite distante (libSQL / Turso).
 * @param profile Profil ou brouillon.
 * @returns `true` pour le mode « URL distante ».
 */
export function isRemoteSqlite(profile: Pick<ConnectionProfile, "driverType" | "sqliteMode">): boolean {
    return profile.driverType === "libsql" || (profile.driverType === "sqlite" && profile.sqliteMode === "url");
}

/**
 * @description Adresse affichée d'un profil et la clé de son libellé, selon son type :
 * fichier, URL distante, URI (MongoDB) ou hôte : port.
 * @param profile Profil sauvegardé.
 * @returns Libellé + valeur.
 */
export function profileAddress(profile: ConnectionProfile): ConnectionAddress {
    if (isRemoteSqlite(profile)) {
        return { labelKey: "connections.view.addrUrl", value: profile.url ?? "" };
    }

    if (profile.driverType === "sqlite") {
        return { labelKey: "connections.view.addrFile", value: profile.filePath ?? "" };
    }

    const hostPort = profile.port ? `${profile.host ?? ""}:${profile.port}` : (profile.host ?? "");

    if (profile.driverType === "mongodb") {
        return { labelKey: "connections.view.addrUri", value: profile.uri || hostPort };
    }

    return { labelKey: "connections.view.addrHost", value: hostPort };
}

/**
 * @description Nom de base affiché d'un profil ; pour un fichier SQLite sans base
 * renseignée, le nom du fichier.
 * @param profile Profil sauvegardé.
 * @returns Le nom, ou `""`.
 */
export function profileDatabaseName(profile: ConnectionProfile): string {
    if (profile.database) {
        return profile.database;
    }

    if (profile.driverType === "sqlite" && profile.filePath) {
        return fileBaseName(profile.filePath);
    }

    return "";
}

/**
 * @description Dernier segment d'un chemin Windows ou POSIX.
 * @param path Chemin de fichier.
 * @returns Le nom du fichier.
 */
export function fileBaseName(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] ?? path;
}

/**
 * @description Port par défaut d'un driver d'après ses métadonnées.
 * @param driverInfos Drivers disponibles.
 * @param type Type recherché.
 * @returns Le port, ou 0 (fichier, URI, type inconnu).
 */
export function defaultPortFor(driverInfos: readonly DriverInfo[], type: DatabaseDriverType): number {
    return driverInfos.find(driver => driver.type === type)?.defaultPort ?? 0;
}

/**
 * @description Construit le brouillon du formulaire depuis un profil existant, ou un
 * brouillon vierge. Un ancien profil MongoDB sans URI reçoit une URI reconstituée depuis
 * son hôte et son port, puisque le formulaire ne propose plus que l'URI.
 * @param profile Profil à éditer, ou `null` pour une création.
 * @param defaults Valeurs par défaut (dossier, SSL, port du type par défaut).
 * @returns Le brouillon.
 */
export function draftFromProfile(profile: ConnectionProfile | null, defaults: ConnectionDraftDefaults): ConnectionDraft {
    if (!profile) {
        return {
            name: "",
            driverType: DEFAULT_DRAFT_DRIVER,
            sqliteMode: "file",
            filePath: "",
            url: "",
            uri: "",
            host: "localhost",
            port: defaults.port,
            username: "",
            password: "",
            clearPassword: false,
            database: "",
            authMode: "sql",
            clientId: "",
            tenantId: "",
            folderId: defaults.folderId,
            tag: "local",
            ssl: defaults.ssl,
            notes: "",
        };
    }

    const remote = isRemoteSqlite(profile);
    let uri = profile.uri ?? "";

    if (profile.driverType === "mongodb" && !uri && profile.host) {
        const port = profile.port ? `:${profile.port}` : "";
        uri = `mongodb://${profile.host}${port}`;
    }

    return {
        name: profile.name,
        driverType: remote ? "sqlite" : profile.driverType,
        sqliteMode: remote ? "url" : "file",
        filePath: profile.filePath ?? "",
        url: profile.url ?? "",
        uri,
        host: profile.host ?? "localhost",
        port: profile.port ?? defaults.port,
        username: profile.username ?? "",
        password: "",
        clearPassword: false,
        database: profile.database ?? "",
        authMode: profile.authMode ?? "sql",
        clientId: profile.clientId ?? "",
        tenantId: profile.tenantId ?? "",
        folderId: profile.folderId ?? defaults.folderId,
        tag: profile.tag ?? "",
        ssl: profile.ssl ?? defaults.ssl,
        notes: profile.notes ?? "",
        color: profile.color,
    };
}

/**
 * @description Indique si le brouillon peut être enregistré.
 * @param draft Brouillon du formulaire.
 * @param hasStoredSecret Le profil édité possède déjà un secret (principal de service).
 * @returns `true` si les champs requis sont renseignés.
 */
export function canSubmitDraft(draft: ConnectionDraft, hasStoredSecret: boolean): boolean {
    if (!draft.name.trim()) {
        return false;
    }

    if (draft.driverType === "sqlite") {
        const address = draft.sqliteMode === "url" ? draft.url : draft.filePath;
        return address.trim() !== "";
    }

    if (draft.driverType === "mongodb") {
        return draft.uri.trim() !== "";
    }

    if (isServicePrincipalDraft(draft)) {
        if (!draft.clientId.trim() || !draft.tenantId.trim()) {
            return false;
        }

        // Le client secret est requis, sauf en édition d'un profil qui en a déjà un.
        if (!draft.password && !hasStoredSecret) {
            return false;
        }
    }

    return draft.host.trim() !== "" && draft.database.trim() !== "";
}

/**
 * @description Seule une base distante peut être partagée : un fichier SQLite local
 * n'est accessible qu'à son poste, le partager reviendrait à envoyer le fichier.
 * @param profile Profil de connexion.
 * @returns `true` pour un serveur, une URI MongoDB ou une base SQLite distante.
 */
export function isShareableProfile(profile: ConnectionProfile): boolean {
    return profile.connectionType !== "file";
}

/**
 * @description Indique si le brouillon utilise l'authentification Azure par principal de service.
 * @param draft Brouillon du formulaire.
 * @returns `true` pour Azure SQL + `service-principal`.
 */
export function isServicePrincipalDraft(draft: ConnectionDraft): boolean {
    return draft.driverType === "azure" && draft.authMode === "service-principal";
}

/**
 * @description Convertit le brouillon en données de profil pour le main. Le mot de passe
 * est « write-only » : en édition, un champ vide signifie « inchangé », sauf si
 * `clearPassword` demande de retirer le secret enregistré.
 * @param draft Brouillon du formulaire.
 * @param editing Édition d'un profil existant (sinon création).
 * @returns Les données à envoyer à `connCreate` / `connUpdate`.
 */
export function buildProfileInput(draft: ConnectionDraft, editing: boolean): ConnectionProfileInput {
    const unchangedPassword = editing && draft.password === "" && !draft.clearPassword;
    const notes = draft.notes.trim();

    const input: ConnectionProfileInput = {
        name: draft.name.trim(),
        color: draft.color,
        driverType: draft.driverType,
        connectionType: "network",
        folderId: draft.folderId || undefined,
        tag: draft.tag || undefined,
        notes: notes || undefined,
        password: unchangedPassword ? undefined : draft.password,
    };

    if (draft.driverType === "sqlite") {
        if (draft.sqliteMode === "url") {
            // Le driver libSQL porte la base distante ; le jeton voyage dans `password`.
            input.driverType = "libsql";
            input.sqliteMode = "url";
            input.url = draft.url.trim();
            input.username = draft.username.trim() || undefined;
            input.database = draft.database.trim() || undefined;
        }
        else {
            input.connectionType = "file";
            input.sqliteMode = "file";
            input.filePath = draft.filePath.trim();
        }

        return input;
    }

    input.ssl = draft.ssl;
    input.database = draft.database.trim();

    if (draft.driverType === "mongodb") {
        input.uri = draft.uri.trim();
        input.username = draft.username.trim() || undefined;
        return input;
    }

    input.host = draft.host.trim();
    input.port = Number(draft.port);

    if (isServicePrincipalDraft(draft)) {
        // Principal de service : pas d'identifiant utilisateur ; le client secret
        // voyage via le champ `password` write-only.
        input.authMode = "service-principal";
        input.clientId = draft.clientId.trim();
        input.tenantId = draft.tenantId.trim();
        return input;
    }

    input.username = draft.username.trim();

    if (draft.driverType === "azure") {
        input.authMode = "sql";
    }

    return input;
}

/**
 * @description Construit la cible d'un test de connexion depuis le brouillon.
 * @param draft Brouillon du formulaire (mot de passe saisi en clair).
 * @param timeoutSeconds Délai avant abandon (réglage « Délai de connexion »).
 * @returns Le corps de `testConnection`.
 */
export function buildTestBody(draft: ConnectionDraft, timeoutSeconds: number, profileId?: string): R_TestConnectionBody {
    const input = buildProfileInput(draft, false);

    if (input.connectionType === "file") {
        return { kind: "file", filePath: input.filePath ?? "" };
    }

    if (input.driverType === "libsql") {
        return {
            kind: "remote-sqlite",
            url: input.url ?? "",
            authToken: input.password || undefined,
            timeoutSeconds,
            profileId,
        };
    }

    return {
        kind: "network",
        driverType: input.driverType,
        host: input.host ?? "",
        port: input.port ?? 0,
        username: input.username ?? "",
        password: input.password ?? "",
        database: input.database ?? "",
        authMode: input.authMode,
        clientId: input.clientId,
        tenantId: input.tenantId,
        uri: input.uri,
        ssl: input.ssl,
        timeoutSeconds,
        profileId,
    };
}

/**
 * @description Convertit une base récente en profil à créer dans le gestionnaire de
 * connexions (action « Enregistrer dans le gestionnaire » du menu contextuel). Le
 * mot de passe n'est jamais connu de l'historique : le profil créé n'en a pas, à
 * ajouter ensuite par « Modifier ».
 * @param entry Base récente.
 * @returns Profil prêt pour `ConnectionsService.create`.
 */
export function profileInputFromRecent(entry: RecentDatabaseEntry): ConnectionProfileInput {
    if (entry.connectionType === "file") {
        return {
            name: entry.displayName,
            driverType: "sqlite",
            connectionType: "file",
            sqliteMode: "file",
            filePath: entry.filePath ?? "",
        };
    }

    if (entry.connectionType === "remote") {
        return {
            name: entry.displayName,
            driverType: "libsql",
            connectionType: "network",
            sqliteMode: "url",
            url: entry.url ?? "",
        };
    }

    return {
        name: entry.displayName,
        driverType: entry.driverType,
        connectionType: "network",
        host: entry.host,
        port: entry.port,
        username: entry.username,
        database: entry.database,
    };
}
