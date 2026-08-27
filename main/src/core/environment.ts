import { app } from "electron/main";
import assert from "node:assert";
import { resolve } from "node:path";
import { AppEnv, Environment, OSType } from "./env.dto";

// ---

assert.ok(process.env.NODE_ENV, "NODE_ENV is not defined");


let env = process.env.NODE_ENV;

if (app.isPackaged && (env === "dev" || env === "development" || env === "debug")) {
    env = "production";
}

let appEnv: AppEnv;

switch (env) {
    case "development":
        process.setSourceMapsEnabled(true);
        appEnv = AppEnv.DEVELOPMENT;
        break;

    case "production":
    default:
        appEnv = AppEnv.PRODUCTION;
        break;
}

// ---

const rootDir = __dirname;
let rendererDir = "";

const appName = app.getName();
const appDisplayName = appName;//.replace(/[^\s]([A-Z])([a-z])/g, " $1$2");
let appVersion = app.getVersion();

// ---

switch (appEnv) {
    case AppEnv.DEVELOPMENT: // angular live reload localhost:4200
        rendererDir = resolve(rootDir, "..", "renderer");
        app.setPath("userData", app.getPath("userData").replace(/\s/g, "") + "-dev");
        appVersion = appVersion.replace("+build", "-dev");
        break;

    case AppEnv.PRODUCTION: // same dist folder
        rendererDir = resolve(rootDir, "browser");
        break;
}

const publicDir = appEnv === AppEnv.DEVELOPMENT
    ? resolve(rendererDir, "public")
    : rendererDir;

// ---

let os: OSType;

switch (process.platform) {
    case "win32":
        os = OSType.Windows;
        break;
    case "darwin":
        os = OSType.MacOS;
        break;
    case "linux":
        os = OSType.Linux;
        break;
    default:
        os = OSType.Windows; // default to Windows if unknown, as it's the most used desktop OS
}

// ---

// Injecté à la compilation par tsup depuis la variable d'environnement du même
// nom : la CI y place `${{ github.repository }}`, de sorte qu'un fork publie ses
// propres mises à jour sans que personne ait à modifier le code.
const updateRepository = process.env.UPDATE_REPOSITORY || "NoxFly/quark";

// `releases/latest/download/...` suit automatiquement la dernière release :
// aucune URL à faire évoluer à chaque publication, ni côté client ni côté CI.
const manifestUrl = `https://github.com/${updateRepository}/releases/latest/download/latest-${os}.json`;

// ---

export const environment: Environment = {
    env: appEnv,
    rootDir,
    publicDir,
    rendererDir,
    os,
    product: {
        name: appName,
        displayName: appDisplayName,
        version: appVersion,
    },
    update: {
        repository: updateRepository,
        manifestUrl,
        releasesUrl: `https://github.com/${updateRepository}/releases/latest`,
    },
};

