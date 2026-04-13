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
};

