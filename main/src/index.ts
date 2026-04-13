
import { bootstrapApplication, Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { OSType } from "src/core/env.dto";
import { environment } from "src/core/environment";
import { routes } from "src/modules/app.routes";

/** Extensions SQLite reconnues passées en argument de ligne de commande. */
const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".s3db"]);

/**
 * Extrait le chemin de fichier SQLite depuis les arguments de ligne de commande.
 */
function extractFileArgument(argv: string[]): string | null {
    // Ignorer les flags electron et l'exécutable lui-même
    const args = argv.slice(app.isPackaged ? 1 : 2);
    for (const arg of args) {
        if (!arg.startsWith("--") && !arg.startsWith("-")) {
            const ext = require("node:path").extname(arg).toLowerCase();
            if (SQLITE_EXTENSIONS.has(ext)) {
                return arg;
            }
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

    Logger.info(`Running in ${environment.env} on ${environment.os} (${process.arch})`);

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

    // const { errorFeedbackMiddleware } = await import("./core/middlewares/error-feedback.middleware");
    // noxApp.use(errorFeedbackMiddleware);

    noxApp.start();

    // Gérer l'ouverture d'un fichier passé en argument initial (Windows/Linux double-clic)
    const initialFile = extractFileArgument(process.argv);
    if (initialFile) {
        // L'application est prête — envoyer le fichier à la première fenêtre
        app.once("browser-window-created", () => {
            setTimeout(() => {
                const { BrowserWindow } = require("electron/main");
                const wins = BrowserWindow.getAllWindows();
                if (wins.length > 0) {
                    wins[0].webContents.send("open-file", initialFile);
                }
            }, 1000);
        });
    }

    // Gérer l'ouverture d'un fichier depuis une seconde instance (Windows/Linux)
    app.on("second-instance", (_event, argv) => {
        const filePath = extractFileArgument(argv);
        if (filePath) {
            const { BrowserWindow } = require("electron/main");
            const wins = BrowserWindow.getAllWindows();
            if (wins.length > 0) {
                const win = wins[0];
                if (win.isMinimized()) {
                    win.restore();
                }
                win.focus();
                win.webContents.send("open-file", filePath);
            }
        }
    });

    // Gérer l'ouverture d'un fichier sur macOS (événement "open-file")
    app.on("open-file", (event, filePath) => {
        event.preventDefault();
        const { BrowserWindow } = require("electron/main");
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
            wins[0].webContents.send("open-file", filePath);
        }
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
