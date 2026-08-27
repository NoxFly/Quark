/**
 * @copyright Dorian Thivolle
 * @license MIT
 * @see https://github.com/NoxFly
 */

import { Controller, Get, inject, Post } from "@noxfly/noxus/main";
import type { UpdateInfo } from "@shared/update";
import { UpdaterService } from "src/modules/updater/updater.service";

@Controller()
export class UpdaterController {
    private readonly updater = inject(UpdaterService);

    /**
     * Interroge le manifeste distant et retourne l'état de mise à jour.
     */
    @Get("check")
    public async check(): Promise<UpdateInfo> {
        return await this.updater.check();
    }

    /**
     * Retourne le résultat de la dernière recherche, sans requête réseau.
     */
    @Get("info")
    public getInfo(): UpdateInfo | null {
        return this.updater.getInfo();
    }

    /**
     * Télécharge, vérifie et applique la mise à jour trouvée.
     */
    @Post("apply")
    public async apply(): Promise<void> {
        await this.updater.applyUpdate();
    }

    /**
     * Ouvre la page des releases dans le navigateur.
     */
    @Post("open-releases")
    public async openReleases(): Promise<void> {
        await this.updater.openReleasesPage();
    }
}
