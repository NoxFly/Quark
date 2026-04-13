import { inject, Injectable, NotFoundException, Request } from "@noxfly/noxus/main";
import { AppState } from "@shared/types";
import { Application } from "src/modules/application";

@Injectable()
export class AppService {
    private readonly application = inject(Application);

    /**
     * Retourne l'état courant de la fenêtre associée au sender.
     */
    public getState(request: Request): AppState {
        const window = this.application.getWindowBySenderId(request.senderId);

        if (!window) {
            return {
                connected: false,
                database: null,
                filePath: null,
            };
        }

        const isOpen = window.database.isOpen;

        return {
            connected: isOpen,
            database: isOpen ? window.getDatabaseSchema() : null,
            filePath: window.database.path,
        };
    }
}
