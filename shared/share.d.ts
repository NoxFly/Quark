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

/**
 * Types partagés du partage d'une base distante.
 *
 * Un fichier `.quarkshare` donne accès à une base sans en révéler les
 * identifiants : chiffré par un mot de passe de partage, il est ouvert (jamais
 * importé dans le coffre) par son destinataire, qui ne voit que les données.
 */

/** Durées de validité proposées, en heures. */
export type ShareExpiryHours = 1 | 4 | 8 | 24 | 48 | 168;

/** Création d'un fichier de partage à partir d'un profil du coffre. */
export interface R_ShareCreateBody {
    /** Profil partagé (base distante uniquement). */
    profileId: string;
    /** Nom affiché chez le destinataire, à la place de l'hôte et de la base. */
    name: string;
    /** Mot de passe de partage, à transmettre à part. */
    password: string;
    /** Consultation uniquement : aucune modification des valeurs. */
    readOnly: boolean;
    /** Le fichier ne s'ouvre qu'une fois. */
    singleUse: boolean;
    /** Durée de validité, `null` : sans limite. */
    expiresInHours: ShareExpiryHours | null;
    /** Utilisateur de la base pour ce partage ; absent : celui du profil. */
    username?: string;
    /** Secret (mot de passe, jeton) pour ce partage ; absent : celui du profil. */
    secret?: string;
}

/** Session partagée ouverte dans une fenêtre, telle que le renderer la connaît. */
export interface ShareSessionState {
    /** Nom choisi par l'auteur du partage. */
    name: string;
    readOnly: boolean;
    /** Échéance (horodatage en millisecondes), `null` : sans limite. */
    expiresAt: number | null;
}

/**
 * Raison d'un refus d'ouverture. Un partage périmé ou déjà ouvert donne la même
 * raison, `unavailable` : rien ne révèle au destinataire qu'un fichier était à
 * usage unique.
 */
export type ShareOpenFailure = "wrong-password" | "unavailable" | "clock-unavailable" | "invalid" | "connection-failed";

/** Résultat de l'ouverture d'un fichier de partage. */
export type R_ShareOpenResponse =
    | {
        ok: true;
        share: ShareSessionState;
        driverType: import("./driver").DatabaseDriverType;
        /** Schéma d'une base SQLite distante ; `null` pour un serveur (chargé à part). */
        database: import("./types").DatabaseSchema | null;
    }
    | {
        ok: false;
        reason: ShareOpenFailure;
        /** Message du driver, expurgé des informations de connexion. */
        detail?: string;
    };
