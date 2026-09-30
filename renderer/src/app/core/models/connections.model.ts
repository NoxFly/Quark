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
    SqliteSourceMode,
} from "@shared/connection";
import type { DatabaseDriverType } from "@shared/driver";

/** Écran d'accès au coffre : création du mot de passe maître, ou déverrouillage. */
export type VaultGateMode = "init" | "unlock";

/** Écran principal du gestionnaire, selon l'état du coffre. */
export type ConnectionsManagerView = "loading" | VaultGateMode | "manager";

/** Taille de la vignette d'un driver : arbre (20 px), en-tête de fiche (40 px), pastille de type (20 px ronde). */
export type DriverThumbVariant = "tree" | "large" | "pill";

/** Déplacement d'un profil par glisser-déposer dans l'arbre du gestionnaire. */
export interface ConnectionProfileMove {
    id: string;
    folderId: string;
    /** Position parmi les autres profils du dossier d'arrivée. */
    index: number;
}

/** Contenu du volet droit du gestionnaire. */
export type ConnectionsPaneMode = "view" | "edit" | "folder";

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
    /**
     * Supprimer le secret déjà enregistré. Nécessaire car un mot de passe vide
     * signifie « inchangé » en édition : sans ce drapeau, un secret ne pouvait
     * plus être retiré d'un profil.
     */
    clearPassword: boolean;
    database: string;
    authMode: AzureAuthMode;
    clientId: string;
    tenantId: string;
    /** Dossier de rangement (`""` : aucun). */
    folderId: string;
    /** Étiquette choisie (`""` : aucune). */
    tag: string;
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
