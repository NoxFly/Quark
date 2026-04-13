import { Logger } from "@noxfly/noxus/main";
import type { DatabaseSchema, DbRecord, FieldDef, ForeignKeyDef, TableSchema } from "@shared/types";
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
     */
    public getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
    ): { records: DbRecord[]; totalCount: number } {
        this.ensureOpen();

        const safeTable = this.escapeIdentifier(tableName);

        // Construire la clause WHERE à partir du filtre personnalisé
        let whereClause = "";
        if (filter && filter.trim().length > 0) {
            whereClause = ` WHERE ${this.parseFilter(filter, tableName)}`;
        }

        // Count total
        const countSql = `SELECT count(*) as cnt FROM ${safeTable}${whereClause}`;
        const countResult = this.db!.prepare(countSql).get() as { cnt: number };

        // Construire le ORDER BY
        let orderClause = "";
        if (orderBy) {
            const safeOrderCol = this.escapeIdentifier(orderBy);
            const dir = orderDir === "DESC" ? "DESC" : "ASC";
            orderClause = ` ORDER BY ${safeOrderCol} ${dir}`;
        }

        const dataSql = `SELECT rowid, * FROM ${safeTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`;
        const records = this.db!.prepare(dataSql).all(limit, offset) as DbRecord[];

        return {
            records,
            totalCount: countResult.cnt,
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
