import { inject, Injectable, NotFoundException, Request } from "@noxfly/noxus/main";
import { AppState } from "@shared/types";
import { Application } from "src/modules/application";

@Injectable()
export class AppService {
    private readonly application = inject(Application);

    /**
     *
     */
    public async getState(request: Request): Promise<AppState> {
        // const window = this.application.getWindowById(request.);

        // if(!window) {
        //     throw new NotFoundException("No focused window found");
        // }

        // const tabs = window?.allTabs || [];

        // return {
        //     tabs
        // };

        // throw new NotFoundException("Not implemeted");

        return {
            currentTabId: 0,
            tabs: new Map(),
        };
    }
}
