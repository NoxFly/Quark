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

import { bootstrapApplication, inject, Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { extname, join } from "node:path";
import { OSType } from "src/core/env.dto";
import { environment } from "src/core/environment";
import { routes } from "src/modules/app.routes";

/** Extensions SQLite reconnues passées en argument de ligne de commande. */
const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".s3db"]);

/** Drapeau posé par la tâche « New Window » de la liste de raccourcis Windows. */
const NEW_WINDOW_FLAG = "--new-window";

/**
 * Extrait le chemin de fichier SQLite des arguments de ligne de commande.
 *
 * Le tri se fait sur l'extension et non sur la position : le nombre d'arguments
 * qui précèdent varie selon que l'application est packagée, lancée depuis la
 * liste de raccourcis, ou démarrée en développement — une découpe par index en
 * écartait certains lancements.
 */
function extractFileArgument(argv: string[]): string | null {
    for (const arg of argv.slice(1)) {
        if (arg.startsWith("-")) {
            continue;
        }

        if (SQLITE_EXTENSIONS.has(extname(arg).toLowerCase())) {
            return arg;
        }
    }

    return null;
}

/**
 *
 */
export async function startApplication(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }

    // Une application packagée n'a pas de console : sans fichier de log, un
    // incident chez un utilisateur ne laisse aucune trace exploitable.
    Logger.enableFileLogging(join(app.getPath("userData"), "logs", "quark.log"));

    Logger.info(`Running in ${environment.env} on ${environment.os} (${process.arch})`);
    Logger.info(`Version ${environment.product.version}, userData: ${app.getPath("userData")}`);

    if (environment.os === OSType.Windows) {
        app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
    }

    app.commandLine.appendSwitch("force-color-profile", "srgb");

    // Detect GPU process crashes early - a crashed GPU process forces Chromium
    // into software rendering, causing severe UI performance degradation on macOS.
    app.on("child-process-gone", (_event, details) => {
        if (details.type === "GPU") {
            Logger.critical(`GPU process terminated: reason=${details.reason}, exitCode=${details.exitCode}`);
            Logger.critical("GPU acceleration may have fallen back to software rendering.");
        }
    });

    const noxApp = await bootstrapApplication({
        routes,
        eagerLoad: [
            () => import("./modules/application"),
        ],
        logLevel: "info",
    });

    const { Application } = await import("./modules/application");
    noxApp.configure(Application);

    const application = inject(Application);

    // Le fichier de lancement est mis en attente AVANT `start()` : le renderer le
    // récupère lui-même via `load-app`, une fois son pont IPC établi. L'ancienne
    // approche (envoi différé de 1 s après la création de la fenêtre) perdait
    // silencieusement le fichier sur les machines lentes à démarrer.
    const initialFile = extractFileArgument(process.argv);

    if (initialFile) {
        application.setPendingFile(initialFile);
    }

    noxApp.start();

    // Toute relance de l'exécutable pendant qu'une instance tourne — entrée de la
    // liste de raccourcis, double-clic sur un fichier associé, raccourci du bureau —
    // arrive ici : la seconde instance rend la main au verrou et se termine.
    // Ignorer ce qu'elle demandait donnait des entrées de menu sans effet.
    app.on("second-instance", (_event, argv) => {
        const filePath = extractFileArgument(argv);

        if (argv.includes(NEW_WINDOW_FLAG)) {
            void application.openNewWindow(filePath);
            return;
        }

        if (filePath) {
            application.openExternalFile(filePath);
            return;
        }

        // Relance sans argument : l'utilisateur veut retrouver son application.
        application.focusExistingWindow();
    });

    // Gérer l'ouverture d'un fichier sur macOS (événement "open-file")
    app.on("open-file", (event, filePath) => {
        event.preventDefault();
        application.openExternalFile(filePath);
    });
}

/**
 *
 */
function handleUncaughtException(error: Error): void {
    const errorDetails = error instanceof Error
        ? error.stack || error.message
        : JSON.stringify(error);

    if (Logger?.critical) {
        Logger.critical("Uncaught exception:", errorDetails);
    }
    else {
        console.error("Uncaught exception (Logger not ready):", errorDetails);
    }
}

/**
 *
 */
function handleUnhandledRejection(reason: unknown): void {
    const reasonDetails = reason instanceof Error
        ? reason.stack || reason.message
        : JSON.stringify(reason);

    if (Logger?.critical) {
        Logger.critical("Unhandled rejection:", reasonDetails);
    }
    else {
        console.error("Unhandled rejection (Logger not ready):", reasonDetails);
    }
}


process.on("uncaughtException", handleUncaughtException);
process.on("unhandledRejection", handleUnhandledRejection);

startApplication().catch(handleUncaughtException);
