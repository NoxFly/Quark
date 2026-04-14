import { Logger } from "@noxfly/noxus/main";
import type { CreateTableColumnDef, DatabaseSchema, DbRecord, FieldDef, ForeignKeyDef, IndexDef, R_AlterTableAction, R_SqlExecResponse, TableSchema } from "@shared/types";
import DatabaseConstructor from "better-sqlite3-multiple-ciphers";
import type BetterSqlite3 from "better-sqlite3-multiple-ciphers";
import { statSync } from "node:fs";
import { basename } from "node:path";

/**
 * Gère une connexion à une base de données SQLite.
 * 1 instance par fenêtre (renderer).
 */
export class Database {
    private db: BetterSqlite3.Database | null = null;
    private filePath: string | null = null;
    private encrypted = false;
    private inTransaction = false;

    /**
     * Ouvre une base de données SQLite.
     * Retourne `true` si un mot de passe est nécessaire (base chiffrée).
     */
    public open(filePath: string): boolean {
        this.close();
        this.filePath = filePath;

        try {
            this.db = new DatabaseConstructor(filePath);

            // Tester si la base est chiffrée en exécutant une requête système
            try {
                this.db.prepare("SELECT count(*) FROM sqlite_master").get();
                this.encrypted = false;
                Logger.info(`Database opened: ${filePath}`);
                return false;
            }
            catch {
                // La requête échoue → la base est probablement chiffrée
                this.db.close();
                this.db = null;
                this.encrypted = true;
                Logger.info(`Database is encrypted: ${filePath}`);
                return true;
            }
        }
        catch (err) {
            this.db = null;
            this.filePath = null;
            throw new Error(`Failed to open database: ${err}`);
        }
    }

    /**
     * Déchiffre et ouvre une base chiffrée avec le mot de passe fourni.
     */
    public unlock(password: string): void {
        if (!this.filePath) {
            throw new Error("No database file to unlock");
        }

        try {
            this.db = new DatabaseConstructor(this.filePath);
            this.db.pragma(`key='${password.replace(/'/g, "''")}'`);

            // Vérifier que le mot de passe est correct
            this.db.prepare("SELECT count(*) FROM sqlite_master").get();
            this.encrypted = false;
            Logger.info(`Database unlocked: ${this.filePath}`);
        }
        catch {
            this.db?.close();
            this.db = null;
            throw new Error("Invalid password or corrupted database");
        }
    }

    /**
     * Ferme la connexion à la base de données.
     */
    public close(): void {
        if (this.inTransaction) {
            try {
                this.rollback();
            }
            catch {
                // Ignorer les erreurs de rollback lors de la fermeture
            }
        }

        this.db?.close();
        this.db = null;
        this.filePath = null;
        this.encrypted = false;
        this.inTransaction = false;
    }

    public get isOpen(): boolean {
        return this.db !== null;
    }

    public get isInTransaction(): boolean {
        return this.inTransaction;
    }

    public get path(): string | null {
        return this.filePath;
    }

    /**
     * Récupère le schéma complet de la base de données.
     */
    public getSchema(): DatabaseSchema {
        this.ensureOpen();

        const name = this.filePath ? basename(this.filePath) : "unknown";

        const tables = this.db!.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all() as { name: string }[];

        const tableSchemas: TableSchema[] = tables.map(t => this.getTableSchema(t.name));

        return {
            name,
            path: this.filePath!,
            tables: tableSchemas,
        };
    }

    /**
     * Récupère le schéma d'une table.
     */
    private getTableSchema(tableName: string): TableSchema {
        this.ensureOpen();

        const safeTableName = this.escapeIdentifier(tableName);

        const columns = this.db!.prepare(`PRAGMA table_info(${safeTableName})`).all() as {
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
            pk: number;
        }[];

        const foreignKeys = this.db!.prepare(`PRAGMA foreign_key_list(${safeTableName})`).all() as {
            from: string;
            table: string;
            to: string;
        }[];

        const fkMap = new Map<string, ForeignKeyDef>();
        for (const fk of foreignKeys) {
            fkMap.set(fk.from, { table: fk.table, column: fk.to });
        }

        const fields: FieldDef[] = columns.map(col => ({
            name: col.name,
            type: col.type,
            notnull: col.notnull === 1,
            dflt_value: col.dflt_value,
            pk: col.pk > 0,
            fk: fkMap.get(col.name) ?? null,
        }));

        const countResult = this.db!.prepare(`SELECT count(*) as cnt FROM ${safeTableName}`).get() as { cnt: number };

        let weight = 0;
        try {
            if (this.filePath) {
                weight = statSync(this.filePath).size;
            }
        }
        catch {
            // Ignorer si on ne peut pas obtenir la taille
        }

        return {
            name: tableName,
            fields,
            weight,
            recordCount: countResult.cnt,
        };
    }

    /**
     * Récupère les données paginées d'une table, avec tri et filtre optionnels.
     * @param filterMode - "sqlite" pour un filtre WHERE brut, "fulltext" pour une recherche texte sur toutes les colonnes.
     */
    public getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode: "sqlite" | "fulltext" = "fulltext",
    ): { records: DbRecord[]; totalCount: number; tableSize: number } {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);

        // Construire la clause WHERE à partir du filtre
        let whereClause = "";
        const whereParams: unknown[] = [];

        if (filter && filter.trim().length > 0) {
            if (filterMode === "sqlite") {
                try {
                    const clause = this.parseFilter(filter, tableName);
                    // Vérifier que la requête est syntaxiquement valide avant de l'utiliser
                    this.db!.prepare(`SELECT 1 FROM ${safeTable} WHERE ${clause} LIMIT 1`);
                    whereClause = ` WHERE ${clause}`;
                }
                catch {
                    // Filtre invalide (saisie incomplète) : retourner un résultat vide
                    return { records: [], totalCount: 0, tableSize: 0 };
                }
            }
            else {
                // Full-text : chercher dans toutes les colonnes textuelles
                const columns = this.db!.prepare(`PRAGMA table_info(${safeTable})`).all() as { name: string }[];
                const conditions = columns.map(c => `CAST(${this.escapeIdentifier(c.name)} AS TEXT) LIKE ?`);
                whereClause = ` WHERE (${conditions.join(" OR ")})`;
                const likeParam = `%${filter.trim()}%`;
                whereParams.push(...columns.map(() => likeParam));
            }
        }

        // Count total
        const countSql = `SELECT count(*) as cnt FROM ${safeTable}${whereClause}`;
        const countResult = this.db!.prepare(countSql).get(...whereParams) as { cnt: number };

        // Construire le ORDER BY
        let orderClause = "";
        if (orderBy) {
            const safeOrderCol = this.escapeIdentifier(orderBy);
            const dir = orderDir === "DESC" ? "DESC" : "ASC";
            orderClause = ` ORDER BY ${safeOrderCol} ${dir}`;
        }

        const dataSql = `SELECT rowid, * FROM ${safeTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`;
        const records = this.db!.prepare(dataSql).all(...whereParams, limit, offset) as DbRecord[];

        // Taille de la table via dbstat (virtual table SQLite)
        let tableSize = 0;
        try {
            const sizeResult = this.db!.prepare(
                "SELECT SUM(pgsize) as sz FROM dbstat WHERE name = ?"
            ).get(tableName) as { sz: number | null };
            tableSize = sizeResult?.sz ?? 0;
        }
        catch {
            // dbstat non disponible
        }

        return {
            records,
            totalCount: countResult.cnt,
            tableSize,
        };
    }

    /**
     * Met à jour une cellule dans une table.
     */
    public updateCell(tableName: string, rowid: number, column: string, value: unknown): void {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);

        this.db!.prepare(`UPDATE ${safeTable} SET ${safeColumn} = ? WHERE rowid = ?`).run(value, rowid);
    }

    /**
     * Supprime des lignes d'une table par leurs rowids.
     */
    public deleteRows(tableName: string, rowids: number[]): void {
        this.ensureOpen();

        if (rowids.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const placeholders = rowids.map(() => "?").join(",");

        this.db!.prepare(`DELETE FROM ${safeTable} WHERE rowid IN (${placeholders})`).run(...rowids);
    }

    /**
     * Récupère une ligne par son rowid.
     */
    public getRow(tableName: string, rowid: number): DbRecord | null {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        const row = this.db!.prepare(`SELECT rowid, * FROM ${safeTable} WHERE rowid = ?`).get(rowid) as DbRecord | undefined;

        return row ?? null;
    }

    /**
     * Insère une nouvelle ligne dans une table.
     * @returns Le rowid de la ligne insérée.
     */
    public insertRow(tableName: string, values: Record<string, unknown>): number {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(values);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const params = columns.map(c => values[c]);

        const result = this.db!.prepare(
            `INSERT INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`
        ).run(...params);

        return Number(result.lastInsertRowid);
    }

    /**
     * Démarre une transaction.
     */
    public beginTransaction(): void {
        this.ensureOpen();

        if (this.inTransaction) {
            throw new Error("A transaction is already active");
        }

        this.db!.prepare("BEGIN TRANSACTION").run();
        this.inTransaction = true;
    }

    /**
     * Valide la transaction en cours.
     */
    public commit(): void {
        this.ensureOpen();

        if (!this.inTransaction) {
            throw new Error("No active transaction");
        }

        this.db!.prepare("COMMIT").run();
        this.inTransaction = false;
    }

    /**
     * Annule la transaction en cours.
     */
    public rollback(): void {
        this.ensureOpen();

        if (!this.inTransaction) {
            throw new Error("No active transaction");
        }

        this.db!.prepare("ROLLBACK").run();
        this.inTransaction = false;
    }

    /**
     * Exporte les données d'une table au format JSON ou CSV.
     */
    public exportData(
        tableName: string,
        format: "json" | "csv",
        rowids?: number[],
        filter?: string,
    ): { data: string; filename: string } {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        let sql: string;

        if (rowids && rowids.length > 0) {
            const placeholders = rowids.map(() => "?").join(",");
            sql = `SELECT * FROM ${safeTable} WHERE rowid IN (${placeholders})`;
        }
        else if (filter && filter.trim().length > 0) {
            const whereClause = this.parseFilter(filter, tableName);
            sql = `SELECT * FROM ${safeTable} WHERE ${whereClause}`;
        }
        else {
            sql = `SELECT * FROM ${safeTable}`;
        }

        const records = rowids && rowids.length > 0
            ? this.db!.prepare(sql).all(...rowids) as DbRecord[]
            : this.db!.prepare(sql).all() as DbRecord[];

        const ext = format === "json" ? "json" : "csv";
        const filename = `${tableName}.${ext}`;

        if (format === "json") {
            return { data: JSON.stringify(records, null, 2), filename };
        }

        // CSV
        if (records.length === 0) {
            return { data: "", filename };
        }

        const columns = Object.keys(records[0]);
        const header = columns.map(c => this.escapeCsvField(c)).join(",");
        const rows = records.map(r =>
            columns.map(c => this.escapeCsvField(String(r[c] ?? ""))).join(",")
        );

        return { data: [header, ...rows].join("\n"), filename };
    }

    /**
     * Exécute une requête SQL arbitraire et retourne les résultats.
     * Pour SELECT : retourne les colonnes + lignes.
     * Pour les autres : retourne le nombre de lignes affectées.
     */
    public execSql(sql: string): R_SqlExecResponse {
        this.ensureOpen();

        let trimmed = sql.trim();
        trimmed = trimmed.endsWith(';') ? trimmed : trimmed + ';';
        const isSelect = /^SELECT\b/i.test(trimmed);

        const t0 = performance.now();

        try {
            const stmt = this.db!.prepare(trimmed);

            if (isSelect) {
                const rows = stmt.all() as Record<string, unknown>[];
                const executionTimeMs = performance.now() - t0;
                const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map(c => c.name);
                return {
                    columns,
                    rows: rows.map(r => columns.map(c => r[c])),
                    rowsAffected: 0,
                    isSelect: true,
                    executionTimeMs,
                };
            }
            else {
                const result = stmt.run();
                const executionTimeMs = performance.now() - t0;
                return {
                    columns: [],
                    rows: [],
                    rowsAffected: result.changes,
                    lastInsertId: Number(result.lastInsertRowid) || undefined,
                    isSelect: false,
                    executionTimeMs,
                };
            }
        }
        catch (err) {
            throw new Error(`SQL error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Importe des données dans une table depuis du CSV ou JSON.
     */
    public importData(tableName: string, format: "csv" | "json", data: string, mode: "insert" | "upsert"): void {
        this.ensureOpen();

        const records = format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);

        if (records.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const columns = Object.keys(records[0]);
        const safeColumns = columns.map(c => this.escapeIdentifier(c)).join(", ");
        const placeholders = columns.map(() => "?").join(", ");

        const orClause = mode === "upsert" ? " OR REPLACE" : "";
        const sql = `INSERT${orClause} INTO ${safeTable} (${safeColumns}) VALUES (${placeholders})`;
        const stmt = this.db!.prepare(sql);

        const runAll = this.db!.transaction((rows: Record<string, unknown>[]) => {
            for (const row of rows) {
                stmt.run(...columns.map(c => row[c] ?? null));
            }
        });

        runAll(records);
    }

    /**
     * Parse et retourne un aperçu des données importées sans les insérer.
     */
    public previewImport(tableName: string, format: "csv" | "json", data: string): { preview: DbRecord[]; totalRows: number; errors: string[] } {
        this.ensureOpen();

        const errors: string[] = [];

        try {
            const records = format === "json" ? this.parseJsonImport(data) : this.parseCsvImport(data);

            // Valider les colonnes contre le schéma
            const schema = this.db!.prepare(`PRAGMA table_info(${this.escapeIdentifier(tableName)})`).all() as { name: string }[];
            const validColumns = new Set(schema.map(c => c.name));

            for (const col of records.length > 0 ? Object.keys(records[0]) : []) {
                if (!validColumns.has(col)) {
                    errors.push(`Column "${col}" does not exist in table "${tableName}"`);
                }
            }

            return {
                preview: records.slice(0, 20),
                totalRows: records.length,
                errors,
            };
        }
        catch (err) {
            return {
                preview: [],
                totalRows: 0,
                errors: [`Parse error: ${err instanceof Error ? err.message : String(err)}`],
            };
        }
    }

    /**
     * Récupère les index d'une table.
     */
    public getIndexes(tableName: string): IndexDef[] {
        this.ensureOpen();

        const rawIndexes = this.db!.pragma(`index_list(${this.escapeIdentifier(tableName)})`) as {
            seq: number;
            name: string;
            unique: number;
            origin: string;
            partial: number;
        }[];

        return rawIndexes.map(idx => {
            const columns = (this.db!.pragma(`index_info(${this.escapeIdentifier(idx.name)})`) as { name: string }[])
                .map(c => c.name);
            return {
                name: idx.name,
                table: tableName,
                unique: idx.unique === 1,
                columns,
                origin: idx.origin,
            };
        });
    }

    /**
     * Crée un index sur une table.
     */
    public createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): void {
        this.ensureOpen();

        const uniqueClause = unique ? "UNIQUE " : "";
        const safeIndex = this.escapeIdentifier(indexName);
        const safeTable = this.escapeIdentifier(tableName);
        const safeCols = columns.map(c => this.escapeIdentifier(c)).join(", ");

        this.db!.prepare(`CREATE ${uniqueClause}INDEX IF NOT EXISTS ${safeIndex} ON ${safeTable} (${safeCols})`).run();
    }

    /**
     * Supprime un index.
     */
    public dropIndex(indexName: string): void {
        this.ensureOpen();

        const safeIndex = this.escapeIdentifier(indexName);
        this.db!.prepare(`DROP INDEX IF EXISTS ${safeIndex}`).run();
    }

    /**
     * Crée une nouvelle table.
     */
    public createTable(name: string, columns: CreateTableColumnDef[], ifNotExists: boolean): void {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(name);
        const ifNotExistsClause = ifNotExists ? "IF NOT EXISTS " : "";

        const pkColumns = columns.filter(c => c.primaryKey);
        const hasSinglePk = pkColumns.length === 1;
        const hasCompositePk = pkColumns.length > 1;

        const colDefs = columns.map(col => {
            const safeName = this.escapeIdentifier(col.name);
            const type = col.type || "TEXT";
            let def = `${safeName} ${type}`;
            if (hasSinglePk && col.primaryKey) {
                def += " PRIMARY KEY";
            }
            if (col.notNull && !col.primaryKey) {
                def += " NOT NULL";
            }
            if (col.unique && !col.primaryKey) {
                def += " UNIQUE";
            }
            if (col.defaultValue !== null && col.defaultValue !== undefined && col.defaultValue !== "") {
                def += ` DEFAULT ${col.defaultValue}`;
            }
            return def;
        });

        if (hasCompositePk) {
            const pkCols = pkColumns.map(c => this.escapeIdentifier(c.name)).join(", ");
            colDefs.push(`PRIMARY KEY (${pkCols})`);
        }

        this.db!.prepare(`CREATE TABLE ${ifNotExistsClause}${safeTable} (${colDefs.join(", ")})`).run();
    }

    /**
     * Modifie le schéma d'une table (rename table, add/rename/drop column).
     */
    public alterTable(action: R_AlterTableAction): void {
        this.ensureOpen();

        switch (action.action) {
            case "rename-table": {
                const safeOld = this.escapeIdentifier(action.table);
                const safeNew = this.escapeIdentifier(action.newName);
                this.db!.prepare(`ALTER TABLE ${safeOld} RENAME TO ${safeNew}`).run();
                break;
            }
            case "add-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeName = this.escapeIdentifier(action.column.name);
                const type = action.column.type || "TEXT";
                let colDef = `${safeName} ${type}`;
                if (action.column.notNull) {
                    colDef += " NOT NULL";
                }
                if (action.column.defaultValue !== null && action.column.defaultValue !== undefined && action.column.defaultValue !== "") {
                    colDef += ` DEFAULT ${action.column.defaultValue}`;
                }
                this.db!.prepare(`ALTER TABLE ${safeTable} ADD COLUMN ${colDef}`).run();
                break;
            }
            case "rename-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeOldCol = this.escapeIdentifier(action.column);
                const safeNewCol = this.escapeIdentifier(action.newName);
                this.db!.prepare(`ALTER TABLE ${safeTable} RENAME COLUMN ${safeOldCol} TO ${safeNewCol}`).run();
                break;
            }
            case "drop-column": {
                const safeTable = this.escapeIdentifier(action.table);
                const safeCol = this.escapeIdentifier(action.column);
                this.db!.prepare(`ALTER TABLE ${safeTable} DROP COLUMN ${safeCol}`).run();
                break;
            }
        }
    }

    /**
     * Change ou supprime le mot de passe de la base SQLCipher.
     * - Pour chiffrer une base non chiffrée : newPassword = 'nouveau mot de passe'
     * - Pour déchiffrer (supprimer le chiffrement) : newPassword = null
     * - Pour changer le mot de passe : newPassword = 'nouveau mot de passe'
     */
    public changePassword(newPassword: string | null): void {
        this.ensureOpen();

        if (newPassword === null) {
            // Supprimer le chiffrement (rekey avec chaîne vide)
            this.db!.pragma("rekey=''");
        }
        else {
            const escaped = newPassword.replace(/'/g, "''");
            this.db!.pragma(`rekey='${escaped}'`);
        }

        Logger.info("Database password changed");
    }

    /**
     * Supprime une table de la base de données.
     */
    public dropTable(tableName: string): void {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);
        this.db!.prepare(`DROP TABLE IF EXISTS ${safeTable}`).run();
    }

    /**
     * Met à jour le même champ sur plusieurs lignes.
     */
    public batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): void {
        this.ensureOpen();

        if (rowids.length === 0) {
            return;
        }

        const safeTable = this.escapeIdentifier(tableName);
        const safeColumn = this.escapeIdentifier(column);
        const placeholders = rowids.map(() => "?").join(",");

        this.db!.prepare(
            `UPDATE ${safeTable} SET ${safeColumn} = ? WHERE rowid IN (${placeholders})`
        ).run(value, ...rowids);
    }

    // --- Helpers d'import ---

    /**
     * Parse un JSON pour l'import (tableau d'objets).
     */
    private parseJsonImport(data: string): Record<string, unknown>[] {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) {
            throw new Error("JSON must be an array of objects");
        }
        return parsed as Record<string, unknown>[];
    }

    /**
     * Parse un CSV simple pour l'import.
     */
    private parseCsvImport(data: string): Record<string, unknown>[] {
        const lines = data.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            return [];
        }

        const headers = this.parseCsvLine(lines[0]);
        const records: Record<string, unknown>[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCsvLine(lines[i]);
            const record: Record<string, unknown> = {};
            for (let j = 0; j < headers.length; j++) {
                const header = headers[j];
                if (header !== undefined) {
                    record[header] = values[j] !== undefined ? this.parseCsvValue(values[j]) : null;
                }
            }
            records.push(record);
        }

        return records;
    }

    /**
     * Parse une ligne CSV en tenant compte des guillemets.
     */
    private parseCsvLine(line: string): string[] {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                }
                else {
                    inQuotes = !inQuotes;
                }
            }
            else if (char === "," && !inQuotes) {
                fields.push(current);
                current = "";
            }
            else {
                current += char;
            }
        }

        fields.push(current);
        return fields;
    }

    /**
     * Convertit une valeur CSV brute en type JS approprié.
     */
    private parseCsvValue(value: string): unknown {
        if (value === "" || value.toLowerCase() === "null") {
            return null;
        }
        if (value.toLowerCase() === "true") {
            return 1;
        }
        if (value.toLowerCase() === "false") {
            return 0;
        }
        const num = Number(value);
        if (!Number.isNaN(num) && value.trim() !== "") {
            return num;
        }
        return value;
    }

    // --- Helpers privés ---

    /**
     * Vérifie que la base est ouverte.
     */
    private ensureOpen(): void {
        if (!this.db) {
            throw new Error("Database is not open");
        }
    }

    /**
     * Échappe un identifiant SQL pour éviter les injections.
     */
    private escapeIdentifier(name: string): string {
        // Retire tout caractère non alphanumérique/underscore pour la sécurité
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return `"${name.replace(/"/g, '""')}"`;
        }
        return `"${name}"`;
    }

    /**
     * Échappe un champ CSV.
     */
    private escapeCsvField(field: string): string {
        if (field.includes(",") || field.includes('"') || field.includes("\n")) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    /**
     * Parse le filtre personnalisé en SQL WHERE sécurisé.
     * Syntaxe supportée :
     * - Comparaisons : =, !=, <>, <, >, <=, >=
     * - LIKE/NOT LIKE avec wildcards %
     * - IN (...) avec listes de valeurs
     * - NOT IN (...)
     * - IS NULL / IS NOT NULL
     * - BETWEEN x AND y
     * - Opérateurs logiques : AND, OR, NOT
     * - Parenthèses de groupement
     * - Fonctions d'agrégat : COUNT, SUM, AVG, MIN, MAX
     * - GLOB, REGEXP (si extension chargée)
     */
    private parseFilter(filter: string, tableName: string): string {
        // Récupérer les colonnes valides de cette table
        const validColumns = new Set(
            (this.db!.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all() as { name: string }[])
                .map(c => c.name.toLowerCase())
        );

        // Mots-clés et fonctions autorisés
        const allowedKeywords = new Set([
            "and", "or", "not", "like", "in", "is", "null",
            "between", "glob", "escape", "exists",
            "case", "when", "then", "else", "end",
            "true", "false",
        ]);

        const allowedFunctions = new Set([
            "count", "sum", "avg", "min", "max",
            "length", "upper", "lower", "trim", "ltrim", "rtrim",
            "substr", "replace", "instr", "typeof", "abs", "round",
            "coalesce", "ifnull", "nullif", "iif",
            "date", "time", "datetime", "strftime",
            "hex", "quote", "zeroblob",
        ]);

        // Tokeniser le filtre
        const tokens = this.tokenize(filter);

        // Valider et reconstruire le SQL sécurisé
        const safeParts: string[] = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const lower = token.toLowerCase();

            // Opérateurs
            if (["=", "!=", "<>", "<", ">", "<=", ">=", "(", ")", ",", "+", "-", "*", "/", "%"].includes(token)) {
                safeParts.push(token);
                continue;
            }

            // Mots-clés SQL autorisés
            if (allowedKeywords.has(lower)) {
                safeParts.push(token.toUpperCase());
                continue;
            }

            // Fonctions autorisées
            if (allowedFunctions.has(lower) && i + 1 < tokens.length && tokens[i + 1] === "(") {
                safeParts.push(lower.toUpperCase());
                continue;
            }

            // Littéraux string (entre quotes simples)
            if (/^'.*'$/.test(token)) {
                safeParts.push(token);
                continue;
            }

            // Littéraux numériques
            if (/^-?\d+(\.\d+)?$/.test(token)) {
                safeParts.push(token);
                continue;
            }

            // Noms de colonne
            if (validColumns.has(lower)) {
                safeParts.push(this.escapeIdentifier(token));
                continue;
            }

            // Identifiant entre guillemets doubles
            if (/^".*"$/.test(token)) {
                const unquoted = token.slice(1, -1).replace(/""/g, '"');
                if (validColumns.has(unquoted.toLowerCase())) {
                    safeParts.push(this.escapeIdentifier(unquoted));
                    continue;
                }
            }

            throw new Error(`Invalid filter token: '${token}'`);
        }

        const result = safeParts.join(" ");
        if (result.trim().length === 0) {
            throw new Error("Empty filter expression");
        }

        return result;
    }

    /**
     * Tokenise une expression de filtre.
     */
    private tokenize(input: string): string[] {
        const tokens: string[] = [];
        let i = 0;

        while (i < input.length) {
            // Espaces
            if (/\s/.test(input[i])) {
                i++;
                continue;
            }

            // String littérale entre quotes simples
            if (input[i] === "'") {
                let j = i + 1;
                while (j < input.length) {
                    if (input[j] === "'") {
                        if (j + 1 < input.length && input[j + 1] === "'") {
                            j += 2; // quote échappée
                        }
                        else {
                            break;
                        }
                    }
                    else {
                        j++;
                    }
                }
                tokens.push(input.slice(i, j + 1));
                i = j + 1;
                continue;
            }

            // Identifiant entre guillemets doubles
            if (input[i] === '"') {
                let j = i + 1;
                while (j < input.length) {
                    if (input[j] === '"') {
                        if (j + 1 < input.length && input[j + 1] === '"') {
                            j += 2;
                        }
                        else {
                            break;
                        }
                    }
                    else {
                        j++;
                    }
                }
                tokens.push(input.slice(i, j + 1));
                i = j + 1;
                continue;
            }

            // Opérateurs multi-caractères
            if (i + 1 < input.length) {
                const twoChar = input.slice(i, i + 2);
                if (["!=", "<>", "<=", ">="].includes(twoChar)) {
                    tokens.push(twoChar);
                    i += 2;
                    continue;
                }
            }

            // Opérateurs simples et ponctuation
            if ("=<>(),+-*/%".includes(input[i])) {
                tokens.push(input[i]);
                i++;
                continue;
            }

            // Nombre
            if (/\d/.test(input[i]) || (input[i] === "-" && i + 1 < input.length && /\d/.test(input[i + 1]))) {
                let j = i;
                if (input[j] === "-") {
                    j++;
                }
                while (j < input.length && /[\d.]/.test(input[j])) {
                    j++;
                }
                tokens.push(input.slice(i, j));
                i = j;
                continue;
            }

            // Mot (identifiant ou mot-clé)
            if (/[a-zA-Z_]/.test(input[i])) {
                let j = i;
                while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) {
                    j++;
                }
                tokens.push(input.slice(i, j));
                i = j;
                continue;
            }

            throw new Error(`Unexpected character in filter: '${input[i]}'`);
        }

        return tokens;
    }
}
