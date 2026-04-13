import { Controller, Get, inject, Request } from "@noxfly/noxus/main";
import type {
    R_CloseFileResponse,
    R_ExportBody,
    R_ExportResponse,
    R_OpenFileBody,
    R_OpenFileResponse,
    R_PasswordBody,
    R_PasswordResponse,
    R_TableDataBody,
    R_TableDataResponse,
    R_UpdateCellBody,
    R_DeleteRowsBody,
    R_TransactionAction,
} from "@shared/types";
import { DbService } from "./db.service";

@Controller()
export class DbController {
    private readonly dbService = inject(DbService);

    @Get("open")
    public async openFile(request: Request): Promise<R_OpenFileResponse> {
        const body = request.body as R_OpenFileBody;
        return this.dbService.openFile(request.senderId, body.filePath);
    }

    @Get("password")
    public async submitPassword(request: Request): Promise<R_PasswordResponse> {
        const body = request.body as R_PasswordBody;
        return this.dbService.submitPassword(request.senderId, body.password);
    }

    @Get("close")
    public async closeFile(request: Request): Promise<R_CloseFileResponse> {
        return this.dbService.closeFile(request.senderId);
    }

    @Get("table-data")
    public async getTableData(request: Request): Promise<R_TableDataResponse> {
        const body = request.body as R_TableDataBody;
        return this.dbService.getTableData(request.senderId, body);
    }

    @Get("update-cell")
    public async updateCell(request: Request): Promise<void> {
        const body = request.body as R_UpdateCellBody;
        return this.dbService.updateCell(request.senderId, body);
    }

    @Get("delete-rows")
    public async deleteRows(request: Request): Promise<void> {
        const body = request.body as R_DeleteRowsBody;
        return this.dbService.deleteRows(request.senderId, body);
    }

    @Get("transaction")
    public async transaction(request: Request): Promise<void> {
        const action = request.body as { action: R_TransactionAction };
        return this.dbService.transactionAction(request.senderId, action.action);
    }

    @Get("export")
    public async exportData(request: Request): Promise<R_ExportResponse> {
        const body = request.body as R_ExportBody;
        return this.dbService.exportData(request.senderId, body);
    }
}
