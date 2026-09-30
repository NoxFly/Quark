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

import type { ConnectionFolder, ConnectionProfile } from "@shared/connection";
import type { DriverInfo } from "@shared/driver";
import { describe, expect, it } from "vitest";
import type { ConnectionDraft } from "src/app/core/models/connections.model";
import {
    buildProfileInput,
    buildTestBody,
    canSubmitDraft,
    defaultPortFor,
    draftFromProfile,
    driverLogo,
    driverMonogram,
    fileBaseName,
    findTag,
    formatLastConnected,
    groupProfilesByFolder,
    isRemoteSqlite,
    profileAddress,
    profileDatabaseName,
    profileDotColor,
    reorderProfiles,
    sortFolders,
    tagColor,
    tagLabel,
    UNFILED_FOLDER_ID,
} from "src/app/shared/helpers/connections.helper";

const LABELS = { today: "Aujourd'hui", yesterday: "Hier", never: "Jamais" };
const DEFAULTS = { folderId: "f1", ssl: true, port: 5432 };

function profile(overrides: Partial<ConnectionProfile>): ConnectionProfile {
    return {
        id: "p",
        name: "p",
        driverType: "postgresql",
        connectionType: "network",
        hasPassword: false,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

function draft(overrides: Partial<ConnectionDraft>): ConnectionDraft {
    return { ...draftFromProfile(null, DEFAULTS), name: "Base", ...overrides };
}

describe("sortFolders", () => {
    it("trie par ordre puis par nom sans muter l'entrée", () => {
        const folders: ConnectionFolder[] = [
            { id: "b", name: "B", order: 1 },
            { id: "z", name: "Z", order: 0 },
            { id: "a", name: "A", order: 1 },
        ];

        expect(sortFolders(folders).map(f => f.id)).toEqual(["z", "a", "b"]);
        expect(folders[0]?.id).toBe("b");
    });
});

describe("groupProfilesByFolder", () => {
    const folders: ConnectionFolder[] = [
        { id: "f2", name: "Dev", order: 1 },
        { id: "f1", name: "Prod", order: 0 },
    ];

    it("range les profils dans leur dossier, triés par nom", () => {
        const tree = groupProfilesByFolder(folders, [
            profile({ id: "b", name: "Beta", folderId: "f2" }),
            profile({ id: "a", name: "Alpha", folderId: "f2" }),
            profile({ id: "c", name: "Gamma", folderId: "f1" }),
        ], "Non classées");

        expect(tree.map(n => n.id)).toEqual(["f1", "f2"]);
        expect(tree[1]?.profiles.map(p => p.id)).toEqual(["a", "b"]);
        expect(tree[0]?.profiles.map(p => p.id)).toEqual(["c"]);
        expect(tree.every(n => !n.virtual)).toBe(true);
    });

    it("envoie les profils sans dossier ou orphelins dans le premier dossier", () => {
        const tree = groupProfilesByFolder(folders, [
            profile({ id: "x" }),
            profile({ id: "y", folderId: "disparu" }),
        ], "Non classées");

        expect(tree[0]?.profiles.map(p => p.id)).toEqual(["x", "y"]);
        expect(tree[1]?.profiles).toEqual([]);
    });

    it("crée un nœud virtuel quand aucun dossier n'existe", () => {
        const tree = groupProfilesByFolder([], [profile({ id: "x" })], "Non classées");

        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ id: UNFILED_FOLDER_ID, name: "Non classées", virtual: true });
        expect(tree[0]?.profiles).toHaveLength(1);
    });

    it("renvoie un arbre vide sans dossier ni profil", () => {
        expect(groupProfilesByFolder([], [], "Non classées")).toEqual([]);
    });

    it("garde les dossiers vides", () => {
        expect(groupProfilesByFolder(folders, [], "Non classées")).toHaveLength(2);
    });
});

describe("reorderProfiles", () => {
    const base = (id: string, folderId: string, order?: number) => ({ id, name: id, folderId, order }) as ConnectionProfile;

    it("insère le profil à la position visée et renumérote son dossier d'arrivée", () => {
        const profiles = [base("a", "f1", 0), base("b", "f1", 1), base("c", "f2", 0)];
        const moved = reorderProfiles(profiles, "c", "f1", 1);
        const f1 = moved.filter(p => p.folderId === "f1").sort((x, y) => (x.order ?? 0) - (y.order ?? 0));

        expect(f1.map(p => p.id)).toEqual(["a", "c", "b"]);
        expect(profiles[2]?.folderId).toBe("f2");
    });

    it("place en premier les profils ordonnés, puis les autres par nom", () => {
        const profiles = [base("zeta", "f1"), base("alpha", "f1"), base("moved", "f2", 0)];
        const moved = reorderProfiles(profiles, "moved", "f1", 99);
        const f1 = moved.filter(p => p.folderId === "f1").sort((x, y) => (x.order ?? 0) - (y.order ?? 0));

        expect(f1.map(p => p.id)).toEqual(["alpha", "zeta", "moved"]);
    });
});

describe("formatLastConnected", () => {
    const now = new Date(2026, 8, 29, 15, 0);

    it("affiche « Jamais » sans horodatage", () => {
        expect(formatLastConnected(undefined, now, "fr", LABELS)).toBe("Jamais");
        expect(formatLastConnected(Number.NaN, now, "fr", LABELS)).toBe("Jamais");
    });

    it("affiche « Aujourd'hui » pour le jour même", () => {
        const ts = new Date(2026, 8, 29, 9, 41).getTime();
        expect(formatLastConnected(ts, now, "fr", LABELS)).toBe("Aujourd'hui 09:41");
    });

    it("affiche « Hier » pour la veille, même moins de 24 h avant", () => {
        const ts = new Date(2026, 8, 28, 17, 20).getTime();
        expect(formatLastConnected(ts, now, "fr", LABELS)).toBe("Hier 17:20");
    });

    it("affiche « Hier » juste avant minuit", () => {
        const midnight = new Date(2026, 8, 29, 0, 5);
        const ts = new Date(2026, 8, 28, 23, 55).getTime();
        expect(formatLastConnected(ts, midnight, "fr", LABELS)).toBe("Hier 23:55");
    });

    it("affiche la date au-delà", () => {
        const ts = new Date(2026, 8, 27, 8, 5).getTime();
        expect(formatLastConnected(ts, now, "fr", LABELS)).toBe("27/09/2026 08:05");
    });

    it("affiche la date au passage d'une année", () => {
        const ts = new Date(2025, 11, 31, 10, 0).getTime();
        expect(formatLastConnected(ts, new Date(2026, 0, 1, 10, 0), "fr", LABELS)).toBe("Hier 10:00");
    });
});

describe("étiquettes et drivers", () => {
    const TAGS = [
        { id: "production", order: 0 },
        { id: "local", order: 1, color: "#46a758" },
        { id: "custom", order: 2, name: "Recette", color: "#8e4ec6" },
    ];

    it("colore une étiquette fournie selon le thème tant qu'elle n'est pas personnalisée", () => {
        expect(tagColor(findTag(TAGS, "production"))).toBe("var(--danger)");
        expect(tagColor(findTag(TAGS, "local"))).toBe("#46a758");
        expect(tagColor(findTag(TAGS, "custom"))).toBe("#8e4ec6");
        expect(tagColor(null)).toBe("var(--text-faint)");
    });

    it("traduit le nom d'une étiquette fournie, garde celui d'une étiquette créée", () => {
        const translate = (key: string): string => `<${key}>`;

        expect(tagLabel(TAGS[0]!, translate)).toBe("<connections.tag.production>");
        expect(tagLabel(TAGS[2]!, translate)).toBe("Recette");
    });

    it("colore la pastille d'un profil selon son étiquette, même supprimée", () => {
        expect(profileDotColor({ tag: "local", color: "#123456" }, TAGS)).toBe("#46a758");
        expect(profileDotColor({ color: "#123456" }, TAGS)).toBe("#123456");
        expect(profileDotColor({ tag: "deleted" }, TAGS)).toBe("var(--text-faint)");
        expect(profileDotColor({}, TAGS)).toBe("var(--text-faint)");
    });

    it("fournit logos et monogrammes", () => {
        expect(driverLogo("libsql")).toBe("images/logo-sqlite.png");
        expect(driverMonogram("postgresql")).toBe("Pg");
        expect(driverMonogram("inconnu" as "sqlite")).toBe("IN");
        expect(driverLogo("inconnu" as "sqlite")).toBeNull();
    });

    it("lit le port par défaut", () => {
        const infos = [{ type: "mysql", defaultPort: 3306 }] as DriverInfo[];
        expect(defaultPortFor(infos, "mysql")).toBe(3306);
        expect(defaultPortFor(infos, "sqlite")).toBe(0);
    });
});

describe("adresse d'un profil", () => {
    it("distingue fichier, URL, URI et hôte : port", () => {
        expect(profileAddress(profile({ driverType: "sqlite", filePath: "C:\\a.db" })))
            .toEqual({ labelKey: "connections.view.addrFile", value: "C:\\a.db" });
        expect(profileAddress(profile({ driverType: "libsql", url: "libsql://x" })))
            .toEqual({ labelKey: "connections.view.addrUrl", value: "libsql://x" });
        expect(profileAddress(profile({ driverType: "sqlite", sqliteMode: "url", url: "https://x" })).labelKey)
            .toBe("connections.view.addrUrl");
        expect(profileAddress(profile({ driverType: "mongodb", uri: "mongodb://h" })))
            .toEqual({ labelKey: "connections.view.addrUri", value: "mongodb://h" });
        expect(profileAddress(profile({ driverType: "mongodb", host: "h", port: 27017 })).value).toBe("h:27017");
        expect(profileAddress(profile({ host: "pg", port: 5432 })))
            .toEqual({ labelKey: "connections.view.addrHost", value: "pg:5432" });
        expect(profileAddress(profile({ host: "pg" })).value).toBe("pg");
    });

    it("déduit le nom de base d'un fichier SQLite", () => {
        expect(profileDatabaseName(profile({ driverType: "sqlite", filePath: "C:\\d\\b.db" }))).toBe("b.db");
        expect(profileDatabaseName(profile({ database: "erp" }))).toBe("erp");
        expect(profileDatabaseName(profile({}))).toBe("");
        expect(fileBaseName("/tmp/x/y.sqlite")).toBe("y.sqlite");
    });

    it("reconnaît le SQLite distant", () => {
        expect(isRemoteSqlite({ driverType: "libsql" })).toBe(true);
        expect(isRemoteSqlite({ driverType: "sqlite", sqliteMode: "url" })).toBe(true);
        expect(isRemoteSqlite({ driverType: "sqlite", sqliteMode: "file" })).toBe(false);
        expect(isRemoteSqlite({ driverType: "mysql", sqliteMode: "url" })).toBe(false);
    });
});

describe("draftFromProfile", () => {
    it("crée un brouillon vierge avec les valeurs par défaut", () => {
        const d = draftFromProfile(null, DEFAULTS);
        expect(d).toMatchObject({ driverType: "postgresql", port: 5432, folderId: "f1", ssl: true, tag: "local" });
    });

    it("présente un profil libSQL comme le mode URL de SQLite", () => {
        const d = draftFromProfile(profile({ driverType: "libsql", url: "libsql://x", tag: "client" }), DEFAULTS);
        expect(d).toMatchObject({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x", tag: "client" });
    });

    it("reconstitue l'URI d'un ancien profil MongoDB", () => {
        const d = draftFromProfile(profile({ driverType: "mongodb", host: "h", port: 27017 }), DEFAULTS);
        expect(d.uri).toBe("mongodb://h:27017");
        expect(draftFromProfile(profile({ driverType: "mongodb", host: "h" }), DEFAULTS).uri).toBe("mongodb://h");
    });

    it("ne réaffiche jamais le mot de passe et garde la couleur", () => {
        const d = draftFromProfile(profile({ hasPassword: true, color: "#123456", ssl: false }), DEFAULTS);
        expect(d.password).toBe("");
        expect(d.color).toBe("#123456");
        expect(d.ssl).toBe(false);
        expect(d.tag).toBe("");
    });
});

describe("canSubmitDraft", () => {
    it("exige un nom", () => {
        expect(canSubmitDraft(draft({ name: " ", host: "h", database: "d" }), false)).toBe(false);
    });

    it("exige l'adresse selon le mode SQLite", () => {
        expect(canSubmitDraft(draft({ driverType: "sqlite", filePath: "a.db" }), false)).toBe(true);
        expect(canSubmitDraft(draft({ driverType: "sqlite", filePath: "" }), false)).toBe(false);
        expect(canSubmitDraft(draft({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x" }), false)).toBe(true);
        expect(canSubmitDraft(draft({ driverType: "sqlite", sqliteMode: "url", filePath: "a.db" }), false)).toBe(false);
    });

    it("exige l'URI pour MongoDB", () => {
        expect(canSubmitDraft(draft({ driverType: "mongodb", uri: "mongodb://h" }), false)).toBe(true);
        expect(canSubmitDraft(draft({ driverType: "mongodb" }), false)).toBe(false);
    });

    it("exige hôte et base pour un serveur", () => {
        expect(canSubmitDraft(draft({ host: "h", database: "d" }), false)).toBe(true);
        expect(canSubmitDraft(draft({ host: "h", database: "" }), false)).toBe(false);
        expect(canSubmitDraft(draft({ host: "", database: "d" }), false)).toBe(false);
    });

    it("exige clientId, tenantId et secret pour un principal de service", () => {
        const sp = { driverType: "azure" as const, authMode: "service-principal" as const, host: "h", database: "d" };
        expect(canSubmitDraft(draft({ ...sp, clientId: "c", tenantId: "t", password: "s" }), false)).toBe(true);
        expect(canSubmitDraft(draft({ ...sp, clientId: "c", tenantId: "t" }), false)).toBe(false);
        expect(canSubmitDraft(draft({ ...sp, clientId: "c", tenantId: "t" }), true)).toBe(true);
        expect(canSubmitDraft(draft({ ...sp, clientId: "", tenantId: "t", password: "s" }), false)).toBe(false);
    });
});

describe("buildProfileInput", () => {
    it("construit un profil fichier SQLite", () => {
        const input = buildProfileInput(draft({ driverType: "sqlite", filePath: " a.db ", password: "k" }), false);
        expect(input).toMatchObject({
            driverType: "sqlite", connectionType: "file", sqliteMode: "file", filePath: "a.db", password: "k",
        });
        expect(input.ssl).toBeUndefined();
    });

    it("construit un profil libSQL avec le jeton en mot de passe", () => {
        const input = buildProfileInput(draft({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x", password: "tok" }), false);
        expect(input).toMatchObject({ driverType: "libsql", connectionType: "network", url: "libsql://x", password: "tok" });
        expect(input.username).toBeUndefined();
    });

    it("garde le mot de passe inchangé en édition quand le champ est vide", () => {
        expect(buildProfileInput(draft({ host: "h", database: "d" }), true).password).toBeUndefined();
        expect(buildProfileInput(draft({ host: "h", database: "d" }), false).password).toBe("");
    });

    it("retire le mot de passe enregistré quand l'utilisateur le demande", () => {
        expect(buildProfileInput(draft({ host: "h", database: "d", clearPassword: true }), true).password).toBe("");
    });

    it("construit un profil MongoDB par URI", () => {
        const input = buildProfileInput(draft({ driverType: "mongodb", uri: "mongodb://h", database: "logs", ssl: false }), false);
        expect(input).toMatchObject({ uri: "mongodb://h", database: "logs", ssl: false, connectionType: "network" });
        expect(input.host).toBeUndefined();
    });

    it("construit un profil serveur avec étiquette, dossier et notes", () => {
        const input = buildProfileInput(draft({
            host: " h ", port: 5433, username: " u ", database: "d", tag: "production", folderId: "", notes: " n ",
        }), false);
        expect(input).toMatchObject({ host: "h", port: 5433, username: "u", tag: "production", notes: "n", ssl: true });
        expect(input.folderId).toBeUndefined();
        expect(input.authMode).toBeUndefined();
    });

    it("gère les deux modes Azure", () => {
        const sql = buildProfileInput(draft({ driverType: "azure", host: "h", database: "d", username: "u" }), false);
        expect(sql).toMatchObject({ authMode: "sql", username: "u" });

        const sp = buildProfileInput(draft({
            driverType: "azure", authMode: "service-principal", host: "h", database: "d", clientId: "c", tenantId: "t", username: "u",
        }), false);
        expect(sp).toMatchObject({ authMode: "service-principal", clientId: "c", tenantId: "t" });
        expect(sp.username).toBeUndefined();
    });
});

describe("buildTestBody", () => {
    it("teste un fichier", () => {
        expect(buildTestBody(draft({ driverType: "sqlite", filePath: "a.db" }), 30)).toEqual({ kind: "file", filePath: "a.db" });
    });

    it("teste une base distante", () => {
        expect(buildTestBody(draft({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x", password: "t" }), 10))
            .toEqual({ kind: "remote-sqlite", url: "libsql://x", authToken: "t", timeoutSeconds: 10 });
        expect(buildTestBody(draft({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x" }), 10))
            .toMatchObject({ authToken: undefined });
    });

    it("teste un serveur avec le délai", () => {
        expect(buildTestBody(draft({ host: "h", port: 5432, username: "u", password: "p", database: "d" }), 60))
            .toMatchObject({ kind: "network", driverType: "postgresql", host: "h", port: 5432, password: "p", ssl: true, timeoutSeconds: 60 });
    });

    it("teste MongoDB par URI", () => {
        expect(buildTestBody(draft({ driverType: "mongodb", uri: "mongodb://h" }), 30))
            .toMatchObject({ kind: "network", driverType: "mongodb", uri: "mongodb://h", host: "", port: 0 });
    });

    it("transmet le profil édité pour réutiliser son secret stocké", () => {
        expect(buildTestBody(draft({ host: "h", password: "" }), 30, "p1")).toMatchObject({ kind: "network", password: "", profileId: "p1" });
        expect(buildTestBody(draft({ driverType: "sqlite", sqliteMode: "url", url: "libsql://x" }), 30, "p2"))
            .toMatchObject({ kind: "remote-sqlite", profileId: "p2" });
        expect(buildTestBody(draft({ host: "h" }), 30)).not.toHaveProperty("profileId", "p1");
    });
});
