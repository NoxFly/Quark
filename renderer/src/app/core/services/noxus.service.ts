import { inject, Injectable } from "@angular/core";
import type { RendererEventRegistry, RequestOptions } from "@noxfly/noxus/renderer";
import { IBatchRequestItem, IBatchResponsePayload, IRequest, NoxRendererClient } from "@noxfly/noxus/renderer";
import type { ErrorDialogPayload, IpcRendererBridge } from "@shared/ipc-renderer";
import { AlertController } from "@ui/alert/alert.controller";
import { BehaviorSubject, from, Observable } from "rxjs";
import { jsonParseSafe } from "src/app/shared/helpers/global.helper";

@Injectable({ providedIn: "root" })
export class NoxusService extends NoxRendererClient {
    public readonly ipc: IpcRendererBridge = window.ipcRenderer;

    public declare readonly events: RendererEventRegistry;
    public declare setup: NoxRendererClient["setup"];
    public declare request: NoxRendererClient["request"];
    public declare batch: NoxRendererClient["batch"];

    private readonly alertCtrl = inject(AlertController);

    public readonly bridgeReady = new BehaviorSubject<boolean>(false);

    public constructor() {
        super();
    }

    /**
     *
     */
    public async init(): Promise<void> {
        await this.setup();

        console.log("senderId:", this.senderId);

        this.ipc.whenDisplayErrorDialog(this.onErrorDialog.bind(this));

        this.bridgeReady.next(true);
    }

    /**
     *
     */
    private onErrorDialog(error: ErrorDialogPayload): void {
        this.alertCtrl.create({
            title: error.title ?? "An error occurred",
            message: error.message,
            color: "danger",
            actions: [
                {
                    text: "OK",
                    role: "cancel",
                },
                {
                    text: "Copy",
                    role: "none",
                    icon: "e8c8",
                    color: "danger-gradient",
                    handler: (self, action) => {
                        const err = structuredClone(error);
                        err.details = jsonParseSafe(err.details);

                        navigator.clipboard.writeText(JSON.stringify(err, null, 4));

                        action.text = "Copié !";
                        action.icon = "e73e";
                    },
                },
            ],
            details: error.details,
        });
    }

    /**
     * Requete le main process - Version Observable
     */
    public request$<T, U = any>(request: Omit<IRequest<U>, "requestId" | "senderId">, options?: RequestOptions): Observable<T> {
        return from(this.request<T, U>(request, options));
    }

    /**
     *
     */
    public batch$(requests: Omit<IBatchRequestItem<unknown>, "requestId">[]): Observable<IBatchResponsePayload> {
        return from(this.batch(requests));
    }
}
