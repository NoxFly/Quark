const cp = require("node:child_process");
const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");
const pkg = require("./package.json");

const windowsIconPath = "dist/browser/favicon.ico";
const linuxIconPath = "dist/browser/app-logo/app-logo-fill-512.png";

// Preserve the native module unpack strategy used previously with electron-forge.
function resolveNativeModuleGlobs() {
    let output;

    try {
        output = cp.execSync("bash ./main/scripts/find-native-modules.sh", {
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    catch (error) {
        output = error.stdout ?? "";
    }

    const modules = [...new Set(
        output
            .toString()
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                const segments = line.split("/");
                const nodeModulesIndex = segments.indexOf("node_modules");

                if (nodeModulesIndex !== -1 && segments.length > nodeModulesIndex + 1) {
                    return segments[nodeModulesIndex + 1];
                }

                return null;
            })
            .filter(Boolean),
    )];

    const nativeModules = modules.map(mod => `**/node_modules/${mod}/**/*`);

    console.info("Resolved native modules for asarUnpack:");
    console.info(`${nativeModules.map(m => `- ${m}`).join("\n")}`);

    return nativeModules;
}

const nativeModuleGlobs = resolveNativeModuleGlobs();

// On supprime les substring au format "+xxxx." ou "-xxxx." pour la version
const version = pkg.version.replace(/([+-]\w+)\./g, ".");
const productName = pkg.productName.replace(/\s+/g, "");
const installerFilename = productName + "-" + version + "-Setup.${ext}";
const appPackageName = productName.toLowerCase();

const publisher = (pkg.author?.name || "").toLowerCase().replace(/\s+/g, "");

/** @type {import("electron-builder").Configuration} */
module.exports = {
    electronVersion: (pkg.devDependencies?.electron || pkg.dependencies?.electron || "41.0.0").replace(/^[~^]/, ""),
    appId: `com.${publisher}.${appPackageName}`,
    productName: pkg.productName,
    npmRebuild: false,
    publish: null,
    artifactName: installerFilename,
    directories: {
        output: "out",
    },
    files: [
        "dist/**",
    ],
    asar: true,
    asarUnpack: [
        "**/*.node",
        ...nativeModuleGlobs,
    ],
    fileAssociations: [
        {
            ext: ["db", "sqlite", "sqlite3", "s3db"],
            name: "Knova",
            description: "Database file editor",
            mimeType: "application/x-sqlite3",
            icon: windowsIconPath,
            role: "Editor",
        },
    ],
    afterPack: async context => {
        const ext = {
            darwin: '.app',
            linux: '',
            win32: '.exe',
        }[context.electronPlatformName];

        const productFilename = context.packager.appInfo.productFilename;
        const electronBinaryPath = path.join(context.appOutDir, productFilename + ext);

        await flipFuses(electronBinaryPath, {
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: false,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
            [FuseV1Options.OnlyLoadAppFromAsar]: false,
        });
    },
    win: {
        target: [
            {
                target: "nsis",
                arch: ["x64"],
            },
        ],
        icon: `${windowsIconPath}`,
        artifactName: installerFilename,
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        allowElevation: false,
        uninstallDisplayName: pkg.productName,
    },
    linux: {
        target: [
            {
                target: "deb",
                arch: ["x64"],
            },
            {
                target: "rpm",
                arch: ["x64"],
            },
        ],
        icon: `${linuxIconPath}`,
        category: "Utility",
        artifactName: installerFilename,
    }
};
