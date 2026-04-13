import { Controller, Get, inject, Request } from "@noxfly/noxus/main";
import { AppState } from "@shared/types";
import { AppService } from "./app.service";

@Controller()
export class AppController {
    private readonly appService = inject(AppService);

    @Get("state")
    public async getAppState(request: Request): Promise<AppState> {
        return await this.appService.getState(request);
    }
}
