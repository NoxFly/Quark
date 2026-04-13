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
    public openFile(senderId: number, filePath: string): R_OpenFileResponse {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        const needsPassword = window.openDatabase(filePath);

        return {
            needsPassword,
            database: needsPassword ? null : window.getDatabaseSchema(),
        };
    }

    /**
     * Soumet un mot de passe pour déchiffrer la base.
     */
    public submitPassword(senderId: number, password: string): R_PasswordResponse {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        window.unlockDatabase(password);

        return {
            database: window.getDatabaseSchema()!,
        };
    }

    /**
     * Ferme le fichier de base de données.
     */
    public closeFile(senderId: number): R_CloseFileResponse {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        window.closeDatabase();

        return { closed: true };
    }

    /**
     * Récupère les données paginées d'une table.
     */
    public getTableData(senderId: number, body: R_TableDataBody): R_TableDataResponse {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        return window.database.getTableData(
            body.table,
            body.offset,
            body.limit,
            body.orderBy,
            body.orderDir,
            body.filter,
        );
    }

    /**
     * Met à jour une cellule.
     */
    public updateCell(senderId: number, body: R_UpdateCellBody): void {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        window.database.updateCell(body.table, body.rowid, body.column, body.value);
    }

    /**
     * Supprime des lignes.
     */
    public deleteRows(senderId: number, body: R_DeleteRowsBody): void {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        window.database.deleteRows(body.table, body.rowids);
    }

    /**
     * Gère les actions de transaction (begin, commit, rollback).
     */
    public transactionAction(senderId: number, action: R_TransactionAction): void {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        switch (action) {
            case "begin":
                window.database.beginTransaction();
                break;
            case "commit":
                window.database.commit();
                break;
            case "rollback":
                window.database.rollback();
                break;
        }
    }

    /**
     * Exporte les données.
     */
    public exportData(senderId: number, body: R_ExportBody): R_ExportResponse {
        const window = this.application.getWindowBySenderId(senderId);
        if (!window) {
            throw new NotFoundException("Window not found");
        }

        return window.database.exportData(body.table, body.format, body.rowids, body.filter);
    }
}
