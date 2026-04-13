
import { bootstrapApplication, Logger } from "@noxfly/noxus/main";
import { app } from "electron/main";
import { OSType } from "src/core/env.dto";
import { environment } from "src/core/environment";
import { routes } from "src/modules/app.routes";

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
