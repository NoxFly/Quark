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
    AzureAuthMode,
    ConnectionProfile,
    ConnectionTag,
    SqliteSourceMode,
} from "@shared/connection";
import type { DatabaseDriverType } from "@shared/driver";

/** Écran d'accès au coffre : création du mot de passe maître, ou déverrouillage. */
export type VaultGateMode = "init" | "unlock";

/** Écran principal du gestionnaire, selon l'état du coffre. */
export type ConnectionsManagerView = "loading" | VaultGateMode | "manager";

/** Taille de la vignette d'un driver : arbre (20 px), en-tête de fiche (40 px), pastille de type (20 px ronde). */
export type DriverThumbVariant = "tree" | "large" | "pill";

/** Contenu du volet droit du gestionnaire. */
export type ConnectionsPaneMode = "view" | "edit" | "folder";

/**
 * Saisie secrète demandée dans la petite modale du gestionnaire :
 * passphrase d'export / d'import, ou bascule du mot de passe maître.
 */
export type SecretPromptKind = "export" | "import" | "enable-master" | "disable-master";

/** Demande de saisie secrète en cours. */
export interface SecretPromptRequest {
    kind: SecretPromptKind;
    /** Profils concernés (export uniquement). */
    ids: string[];
}

/** Valeur émise par la modale de saisie secrète. */
export interface SecretPromptSubmit {
    secret: string;
}

/**
 * Dossier de l'arbre du gestionnaire, avec ses profils déjà triés.
 * `virtual` : nœud de repli affiché quand aucun dossier n'existe encore.
 */
export interface ConnectionFolderNode {
    id: string;
    name: string;
    profiles: ConnectionProfile[];
    virtual: boolean;
}

/** Libellés traduits utilisés pour formater la date de dernière connexion. */
export interface LastConnectedLabels {
    today: string;
    yesterday: string;
    never: string;
}

/** Adresse affichée d'un profil : clé i18n du libellé + valeur. */
export interface ConnectionAddress {
    labelKey: string;
    value: string;
}

/**
 * Brouillon du formulaire de connexion. `driverType` est le type de la pastille
 * sélectionnée : jamais `libsql`, présenté comme le mode « URL distante » de SQLite.
 */
export interface ConnectionDraft {
    name: string;
    driverType: DatabaseDriverType;
    sqliteMode: SqliteSourceMode;
    filePath: string;
    url: string;
    uri: string;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    authMode: AzureAuthMode;
    clientId: string;
    tenantId: string;
    /** Dossier de rangement (`""` : aucun). */
    folderId: string;
    tag: ConnectionTag;
    ssl: boolean;
    notes: string;
    /** Couleur héritée des anciens profils, conservée telle quelle. */
    color?: string;
}

/** Valeurs par défaut d'un nouveau brouillon. */
export interface ConnectionDraftDefaults {
    folderId: string;
    ssl: boolean;
    port: number;
}
