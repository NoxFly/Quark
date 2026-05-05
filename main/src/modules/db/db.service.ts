import { inject, Injectable, Logger, NotFoundException } from "@noxfly/noxus/main";
import type {
    R_CloseFileResponse,
    R_DeleteRowsBody,
    R_ExportBody,
    R_ExportResponse,
    R_OpenFileResponse,
    R_PasswordResponse,
    R_TableDataBody,
    R_TableDataResponse,
    R_TransactionAction,
    R_UpdateCellBody,
} from "@shared/types";
import { Application } from "src/modules/application";

@Injectable()
export class DbService {
    private readonly application = inject(Application);

    /**
     * Ouvre un fichier de base de données pour la fenêtre donnée.
     */
    public async openFile(senderId: number, filePath: string): Promise<R_OpenFileResponse> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        const needsPassword = await window.openDatabase(filePath);

        return {
            needsPassword,
            database: needsPassword ? null : await window.getDatabaseSchema(),
        };
    }

    /**
     * Soumet un mot de passe pour déchiffrer la base.
     */
    public async submitPassword(senderId: number, password: string): Promise<R_PasswordResponse> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        await window.unlockDatabase(password);

        return {
            database: (await window.getDatabaseSchema())!,
        };
    }

    /**
     * Ferme le fichier de base de données.
     */
    public async closeFile(senderId: number): Promise<R_CloseFileResponse> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        await window.closeDatabase();

        return { closed: true };
    }

    /**
     * Récupère les données paginées d'une table.
     */
    public async getTableData(senderId: number, body: R_TableDataBody): Promise<R_TableDataResponse> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        return await window.database.getTableData(
            body.table,
            body.offset,
            body.limit,
            body.orderBy,
            body.orderDir,
            body.filter,
            body.filterMode,
        );
    }

    /**
     * Met à jour une cellule.
     */
    public async updateCell(senderId: number, body: R_UpdateCellBody): Promise<void> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        await window.database.updateCell(body.table, body.rowid, body.column, body.value);
    }

    /**
     * Supprime des lignes.
     */
    public async deleteRows(senderId: number, body: R_DeleteRowsBody): Promise<void> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        await window.database.deleteRows(body.table, body.rowids);
    }

    /**
     * Gère les actions de transaction (begin, commit, rollback).
     */
    public async transactionAction(senderId: number, action: R_TransactionAction): Promise<void> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        switch (action) {
            case "begin":
                await window.database.beginTransaction();
                break;
            case "commit":
                await window.database.commit();
                break;
            case "rollback":
                await window.database.rollback();
                break;
        }
    }

    /**
     * Exporte les données.
     */
    public async exportData(senderId: number, body: R_ExportBody): Promise<R_ExportResponse> {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        return await window.database.exportData(body.table, body.format, body.rowids, body.filter);
    }
}
