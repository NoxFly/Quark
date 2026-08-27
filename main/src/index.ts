
import { bootstrapApplication, inject, Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { extname, join } from "node:path";
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
            const ext = extname(arg).toLowerCase();
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

    // const { errorFeedbackMiddleware } = await import("./core/middlewares/error-feedback.middleware");
    // noxApp.use(errorFeedbackMiddleware);

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

    // Gérer l'ouverture d'un fichier depuis une seconde instance (Windows/Linux)
    app.on("second-instance", (_event, argv) => {
        const filePath = extractFileArgument(argv);

        if (filePath) {
            application.openExternalFile(filePath);
        }
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
