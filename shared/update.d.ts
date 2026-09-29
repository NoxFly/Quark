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
 * Types partagés du système de mise à jour automatique.
 *
 * L'application interroge un manifeste `latest-<os>.json` publié comme asset de
 * la dernière release GitHub. Aucune configuration utilisateur n'est requise :
 * l'URL est figée à la compilation depuis le dépôt d'origine.
 */

/** Manifeste publié à côté de l'installeur pour une plateforme donnée. */
export interface UpdateManifest {
    /** Version publiée (semver éventuellement suffixé `+build.<n>`). */
    version: string;
    /** Date de publication au format ISO 8601. */
    releaseDate: string;
    /** Nom du fichier d'installation. */
    path: string;
    /** URL de téléchargement complète de l'installeur. */
    url: string;
    /** Empreinte SHA-512 hexadécimale de l'installeur. */
    sha512: string;
    /** Notes de version (corps de la release GitHub). */
    notes?: string;
}

/** État de la recherche de mise à jour, tel qu'exposé au renderer. */
export interface UpdateInfo {
    /** Version actuellement exécutée. */
    currentVersion: string;
    /** Dernière version publiée. */
    version: string;
    /** Date de publication au format ISO 8601. */
    releaseDate: string;
    /** La version publiée est plus récente que la version courante. */
    isNewer: boolean;
    /**
     * La mise à jour peut être appliquée par l'application elle-même.
     * Faux sur les plateformes dont le paquet requiert une élévation (deb/rpm) :
     * l'installeur est alors seulement téléchargé et révélé à l'utilisateur.
     */
    canAutoInstall: boolean;
    /**
     * La mise à jour sera installée sans rien demander, puis l'application
     * redémarrera (réglage « mises à jour automatiques » actif).
     */
    autoInstall: boolean;
    /** Notes de version. */
    notes?: string;
}

/** Réglages de mise à jour. */
export interface UpdateSettings {
    /** Installer automatiquement les mises à jour, puis redémarrer. */
    autoUpdate: boolean;
    /** La plateforme permet l'installation automatique (Windows uniquement). */
    supported: boolean;
}

/** Progression du téléchargement de l'installeur. */
export interface UpdateProgress {
    /** Octets reçus. */
    received: number;
    /** Taille totale annoncée, `0` si le serveur ne la fournit pas. */
    total: number;
    /** Pourcentage entier, `-1` si la taille totale est inconnue. */
    percent: number;
}
