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

import type { FieldDef } from "@shared/types";

/**
 * Mode d'ouverture de l'éditeur de record.
 */
export type RecordEditorMode = "create" | "edit" | "duplicate";

/**
 * Représente un champ du formulaire avec ses métadonnées.
 */
export interface RecordFormField {
    def: FieldDef;
    value: string;
    disabled: boolean;
    /** Texte indicatif affiché dans le champ vide. */
    placeholder: string;
    /** Le formulaire a rempli ou réservé cette valeur ; l'utilisateur n'a rien à saisir. */
    autoFilled: boolean;
}

/**
 * Ce que le formulaire doit faire de la clé primaire lors d'une création.
 *
 * - `autoincrement` : `INTEGER PRIMARY KEY` est l'alias du rowid ; SQLite
 *   attribue la valeur dès que la colonne est omise de l'insertion.
 * - `uuid` : la colonne porte des identifiants générés côté application ; le
 *   formulaire en produit un nouveau plutôt que de le demander à l'utilisateur.
 * - `manual` : identifiant métier (un code, une référence) : à saisir.
 */
export type PrimaryKeyKind = "autoincrement" | "uuid" | "manual";
