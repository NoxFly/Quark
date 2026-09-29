/*
 * Quark
 * Copyright (C) 2026 NoxFly
 *
 * FR : Ce programme est un logiciel libre ; vous pouvez le redistribuer ou le
 * modifier selon les termes de la GNU Affero General Public License, version 3,
 * telle que publiée par la Free Software Foundation. Il est distribué dans
 * l'espoir d'être utile, mais SANS AUCUNE GARANTIE. Voir le fichier LICENSE.
 *
 * EN : This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License, version 3, as
 * published by the Free Software Foundation. It is distributed in the hope that
 * it will be useful, but WITHOUT ANY WARRANTY. See the LICENSE file.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DatabaseCategory, DatabaseDriverType, DriverCapabilities, DriverInfo } from "@shared/driver";
import type {
    CreateTableColumnDef,
    DatabaseSchema,
    DbRecord,
    IndexDef,
    R_AlterTableAction,
    R_SqlExecResponse,
    TableSchema,
} from "@shared/types";
import type { DatabaseDriver } from "src/core/drivers/driver.interface";
import { getDriverInfo } from "src/core/drivers/driver-registry";
import { MongoClient, type Db, ObjectId } from "mongodb";

/**
 * Driver MongoDB utilisant le package officiel `mongodb`.
 * Implémente `DatabaseDriver` directement (pas de `NetworkSqlDriver`)
 * car MongoDB est NoSQL et n'utilise pas de requêtes SQL.
 *
 * Les "tables" sont mappées sur les collections,
 * et `_id` sert d'identifiant primaire.
 */
export class MongodbDriver implements DatabaseDriver {
    public readonly driverType: DatabaseDriverType = "mongodb";
    public readonly category: DatabaseCategory = "nosql";

    private client: MongoClient | null = null;
    private db: Db | null = null;
    private _path: string | null = null;
    private _isOpen = false;

    public get info(): DriverInfo {
        return getDriverInfo(this.driverType);
    }

    public get capabilities(): DriverCapabilities {
        return this.info.capabilities;
    }

    public get isOpen(): boolean {
        return this._isOpen;
    }

    public get isInTransaction(): boolean {
        return false;
    }

    public get path(): string | null {
        return this._path;
    }

    // --- Cycle de vie ---

    /**
     * Ouvre une connexion MongoDB.
     * @param connectionUri URI au format `user:password@host:port/database`
     * @returns Toujours `false` (MongoDB ne supporte pas le chiffrement fichier).
     */
    public async open(connectionUri: string): Promise<boolean> {
        const { host, port, database, user, password } = this.parseUri(connectionUri);

        let mongoUri: string;
        if (user && password) {
            mongoUri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
        }
        else {
            mongoUri = `mongodb://${host}:${port}`;
        }

        this.client = new MongoClient(mongoUri);
        await this.client.connect();

        // client.db() est lazy : il ne vérifie jamais l'existence de la base.
        // On passe par listDatabases pour s'assurer qu'elle existe réellement.
        const { databases } = await this.client.db().admin().listDatabases({ nameOnly: true });
        const dbExists = (databases as { name: string }[]).some(d => d.name === database);

        if (!dbExists) {
            await this.client.close();
            this.client = null;
            throw new Error(`Database "${database}" does not exist`);
        }

        this.db = this.client.db(database);
        this._path = connectionUri;
        this._isOpen = true;

        return false;
    }

    public async unlock(_password: string): Promise<void> {
        throw new Error("MongoDB does not support file-level encryption");
    }

    public async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
        this._isOpen = false;
        this._path = null;
    }

    // --- Schéma ---

    public async getSchema(): Promise<DatabaseSchema> {
        this.ensureOpen();

        const collections = await this.db!.listCollections().toArray();
        const tables: TableSchema[] = [];

        for (const col of collections) {
            const collection = this.db!.collection(col.name);
            const count = await collection.countDocuments();

            // Infère le schéma depuis le premier document
            const sample = await collection.findOne();
            const fields = sample
                ? Object.keys(sample).map(key => ({
                      name: key,
                      type: this.inferBsonType(sample[key]),
                      notnull: key === "_id",
                      dflt_value: null,
                      pk: key === "_id",
                      fk: null,
                  }))
                : [{ name: "_id", type: "ObjectId", notnull: true, dflt_value: null, pk: true, fk: null }];

            tables.push({
                name: col.name,
                fields,
                weight: 0,
                recordCount: count,
            });
        }

        return {
            name: this.db!.databaseName,
            path: this._path!,
            tables,
            driverType: this.driverType,
        };
    }

    public async getTablesSql(): Promise<{ name: string; sql: string }[]> {
        throw new Error("MongoDB does not support SQL queries");
    }

    // --- Données ---

    /**
     * Extrait la clause ORDER BY du filtre MongoDB s'il existe.
     * Retourne { queryString, orderClause } où orderClause est vide ou commence par " ORDER BY".
     */
    private extractOrderByFromFilter(filter: string): { queryString: string; orderClause: string } {
        const trimmed = filter.trim();

        // Vérifier si le filtre commence par ORDER BY
        if (trimmed.match(/^\s*ORDER\s+BY\s+/i)) {
            return { queryString: "{}", orderClause: trimmed };
        }

        // Chercher "ORDER BY" dans le filtre
        const orderByMatch = trimmed.match(/^([\s\S]*?)\s+(ORDER\s+BY\s+[\s\S]+)$/i);

        if (!orderByMatch) {
            return { queryString: trimmed, orderClause: "" };
        }

        const queryString = orderByMatch[1].trim();
        const orderByPart = orderByMatch[2];

        return {
            queryString,
            orderClause: orderByPart // Trimmed, sans espace avant
        };
    }

    /**
     * Parse une clause ORDER BY SQL et la convertit en sort object MongoDB.
     * Ex: "name ASC, age DESC" -> { name: 1, age: -1 }
     */
    private parseOrderByToMongoSort(orderByClause: string): Record<string, 1 | -1> {
        const sort: Record<string, 1 | -1> = {};

        if (!orderByClause || orderByClause.trim().length === 0) {
            return sort;
        }

        // Enlever "ORDER BY" du début
        const clause = orderByClause.replace(/^\s*ORDER\s+BY\s+/i, "").trim();

        // Splitter par les virgules
        const parts = clause.split(",").map(p => p.trim());

        for (const part of parts) {
            if (!part) {
                continue;
            }

            // Chercher "ASC" ou "DESC"
            const ascDescMatch = part.match(/^(\w+)\s+(ASC|DESC)$/i);
            if (ascDescMatch) {
                const fieldName = ascDescMatch[1];
                const direction = ascDescMatch[2].toUpperCase();
                sort[fieldName] = direction === "DESC" ? -1 : 1;
            }
            else {
                // Si pas d'ASC/DESC spécifié, par défaut ASC
                const fieldMatch = part.match(/^(\w+)$/);
                if (fieldMatch) {
                    sort[fieldMatch[1]] = 1;
                }
            }
        }

        return sort;
    }

    public async getTableData(
        tableName: string,
        offset: number,
        limit: number,
        orderBy?: string,
        orderDir?: "ASC" | "DESC",
        filter?: string,
        filterMode?: "sql" | "fulltext",
    ): Promise<{ records: DbRecord[]; totalCount: number; tableSize: number }> {
        this.ensureOpen();

        const collection = this.db!.collection(tableName);

        let query: Record<string, unknown> = {};
        let filterOrderClause = "";
        if (filter && filter.trim().length > 0) {
            if (filterMode === "sql") {
                // Extraire l'ORDER BY du filtre s'il existe
                const { queryString, orderClause } = this.extractOrderByFromFilter(filter);
                filterOrderClause = orderClause;

                // Mode filtre SQL/NoSQL : parser la requête JSON MongoDB
                try {
                    query = JSON.parse(queryString.trim());
                    console.log("[MongoDB] JSON query parsed:", JSON.stringify(query));
                }
                catch {
                    // Essayer de convertir le format MongoDB (sans quotes autour des clés) en JSON strict
                    try {
                        const strictJson = queryString.trim().replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
                        query = JSON.parse(strictJson);
                        console.log("[MongoDB] JSON query parsed (after conversion):", JSON.stringify(query));
                    }
                    catch (fallbackErr) {
                        // Si le parse échoue aussi, log et traiter comme requête vide
                        console.error("[MongoDB] Failed to parse JSON query:", queryString.trim(), fallbackErr);
                        query = {};
                    }
                }
            }
            else {
                // Mode recherche full-text : essayer $text d'abord
                query = { $text: { $search: filter.trim() } };
            }
        }

        let totalCount = 0;
        let docs: Record<string, unknown>[] = [];

        try {
            totalCount = await collection.countDocuments(query);
            console.log("[MongoDB] Query results - total count:", totalCount, "query:", JSON.stringify(query));

            const sort: Record<string, 1 | -1> = {};
            if (filterOrderClause) {
                // Utiliser l'ORDER BY du filtre converti en format MongoDB
                Object.assign(sort, this.parseOrderByToMongoSort(filterOrderClause));
            }
            else if (orderBy) {
                sort[orderBy] = orderDir === "DESC" ? -1 : 1;
            }
            else if (filterMode === "sql") {
                // En mode SQL, trier par _id par défaut pour une pagination stable
                sort["_id"] = 1;
            }

            docs = await collection
                .find(query)
                .sort(sort)
                .skip(offset)
                .limit(limit)
                .toArray();
        }
        catch (err) {
            // Si la requête $text échoue (pas d'index texte), fallback à regex
            if (
                filterMode !== "sql"
                && filter
                && (err as any)?.codeName === "IndexNotFound"
            ) {
                try {
                    // Récupérer un document d'exemple pour voir la structure
                    const sample = await collection.findOne({});
                    const fields = sample ? Object.keys(sample).filter(f => f !== "_id") : [];

                    if (fields.length > 0) {
                        // Créer une requête $or sur tous les champs avec regex case-insensitive
                        const conditions = fields.map(f => ({
                            [f]: { $regex: filter.trim(), $options: "i" }
                        }));
                        query = { $or: conditions };

                        totalCount = await collection.countDocuments(query);

                        const sort: Record<string, 1 | -1> = {};
                        if (filterOrderClause) {
                            // Utiliser l'ORDER BY du filtre converti en format MongoDB
                            Object.assign(sort, this.parseOrderByToMongoSort(filterOrderClause));
                        }
                        else if (orderBy) {
                            sort[orderBy] = orderDir === "DESC" ? -1 : 1;
                        }
                        else {
                            // Fallback de recherche : trier par _id par défaut pour une pagination stable
                            sort["_id"] = 1;
                        }

                        docs = await collection
                            .find(query)
                            .sort(sort)
                            .skip(offset)
                            .limit(limit)
                            .toArray();
                    }
                    else {
                        // Pas de champs, pas de résultats
                        totalCount = 0;
                        docs = [];
                    }
                }
                catch (fallbackErr) {
                    // Si le fallback échoue aussi, log l'erreur et retourner vide
                    console.error("Fallback search failed:", fallbackErr);
                    totalCount = 0;
                    docs = [];
                }
            }
            else {
                // Si ce n'est pas une erreur d'index texte, relancer l'erreur
                throw err;
            }
        }

        const records = docs.map(doc => this.docToRecord(doc as DbRecord));

        return { records, totalCount, tableSize: 0 };
    }

    public async updateCell(tableName: string, rowid: number, column: string, value: unknown): Promise<void> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const objectId = this.toObjectId(rowid);
        await collection.updateOne({ _id: objectId }, { $set: { [column]: value } });
    }

    public async deleteRows(tableName: string, rowids: number[]): Promise<void> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const ids = rowids.map(id => this.toObjectId(id));
        await collection.deleteMany({ _id: { $in: ids } });
    }

    public async getRow(tableName: string, rowid: number): Promise<DbRecord | null> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const doc = await collection.findOne({ _id: this.toObjectId(rowid) });
        return doc ? this.docToRecord(doc) : null;
    }

    public async insertRow(tableName: string, values: Record<string, unknown>): Promise<number> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const result = await collection.insertOne(values);
        return result.insertedId.toString() as unknown as number;
    }

    public async batchUpdate(tableName: string, rowids: number[], column: string, value: unknown): Promise<void> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const ids = rowids.map(id => this.toObjectId(id));
        await collection.updateMany({ _id: { $in: ids } }, { $set: { [column]: value } });
    }

    // --- Transactions (non supporté en mode simplifié) ---

    public async beginTransaction(): Promise<void> {
        throw new Error("MongoDB transactions require replica sets and are not supported in this driver");
    }

    public async commit(): Promise<void> {
        throw new Error("MongoDB transactions require replica sets and are not supported in this driver");
    }

    public async rollback(): Promise<void> {
        throw new Error("MongoDB transactions require replica sets and are not supported in this driver");
    }

    // --- Export / Import ---

    public async exportData(
        tableName: string,
        format: "json" | "csv" | "xlsx",
        rowids?: number[],
        _filter?: string,
    ): Promise<{ data: string; filename: string }> {
        this.ensureOpen();

        const collection = this.db!.collection(tableName);
        let query: Record<string, unknown> = {};
        if (rowids && rowids.length > 0) {
            query = { _id: { $in: rowids.map(id => this.toObjectId(id)) } };
        }

        const docs = await collection.find(query).toArray();
        const records = docs.map(doc => this.docToRecord(doc));

        if (format === "json") {
            return { data: JSON.stringify(records, null, 2), filename: `${tableName}.json` };
        }

        if (format === "csv") {
            if (records.length === 0) {
                return { data: "", filename: `${tableName}.csv` };
            }
            const headers = Object.keys(records[0]);
            const csvRows = [headers.join(",")];
            for (const record of records) {
                const row = headers.map(h => {
                    const val = record[h];
                    if (val === null || val === undefined) {
                        return "";
                    }
                    const str = String(val);
                    return str.includes(",") || str.includes('"') || str.includes("\n")
                        ? `"${str.replace(/"/g, '""')}"`
                        : str;
                });
                csvRows.push(row.join(","));
            }
            return { data: csvRows.join("\n"), filename: `${tableName}.csv` };
        }

        throw new Error(`Export format "${format}" is not supported for MongoDB`);
    }

    public async importData(
        tableName: string,
        format: "csv" | "json",
        data: string,
        _mode: "insert" | "upsert",
    ): Promise<void> {
        this.ensureOpen();

        const records = format === "json"
            ? JSON.parse(data) as Record<string, unknown>[]
            : this.parseCsv(data);

        if (records.length === 0) {
            return;
        }

        const collection = this.db!.collection(tableName);
        await collection.insertMany(records);
    }

    public async previewImport(
        _tableName: string,
        format: "csv" | "json",
        data: string,
    ): Promise<{ preview: DbRecord[]; totalRows: number; errors: string[] }> {
        try {
            const records = format === "json"
                ? JSON.parse(data) as Record<string, unknown>[]
                : this.parseCsv(data);

            return {
                preview: records.slice(0, 100) as DbRecord[],
                totalRows: records.length,
                errors: [],
            };
        }
        catch (err) {
            return {
                preview: [],
                totalRows: 0,
                errors: [(err as Error).message],
            };
        }
    }

    // --- SQL (non supporté) ---

    public async execSql(_sql: string): Promise<R_SqlExecResponse> {
        throw new Error("MongoDB does not support SQL queries");
    }

    // --- Index ---

    public async getIndexes(tableName: string): Promise<IndexDef[]> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const indexes = await collection.indexes();

        return indexes.map(idx => ({
            name: idx.name ?? "unknown",
            table: tableName,
            unique: Boolean(idx.unique),
            columns: Object.keys(idx.key as Record<string, unknown>),
            origin: "c" as const,
        }));
    }

    public async createIndex(tableName: string, indexName: string, columns: string[], unique: boolean): Promise<void> {
        this.ensureOpen();
        const collection = this.db!.collection(tableName);
        const keys: Record<string, 1> = {};
        for (const col of columns) {
            keys[col] = 1;
        }
        await collection.createIndex(keys, { name: indexName, unique });
    }

    public async dropIndex(indexName: string): Promise<void> {
        this.ensureOpen();
        // On cherche dans toutes les collections pour trouver l'index
        const collections = await this.db!.listCollections().toArray();
        for (const col of collections) {
            const collection = this.db!.collection(col.name);
            const indexes = await collection.indexes();
            if (indexes.some(idx => idx.name === indexName)) {
                await collection.dropIndex(indexName);
                return;
            }
        }
        throw new Error(`Index "${indexName}" not found`);
    }

    // --- Schéma (non supporté pour NoSQL) ---

    public async createTable(name: string, _columns: CreateTableColumnDef[], _ifNotExists: boolean): Promise<void> {
        this.ensureOpen();
        await this.db!.createCollection(name);
    }

    public async alterTable(_action: R_AlterTableAction): Promise<void> {
        throw new Error("MongoDB does not support ALTER TABLE operations");
    }

    public async dropTable(tableName: string): Promise<void> {
        this.ensureOpen();
        await this.db!.dropCollection(tableName);
    }

    // --- Chiffrement ---

    public async changePassword(_newPassword: string | null): Promise<void> {
        throw new Error("MongoDB does not support file-level encryption");
    }

    // --- Helpers privés ---

    /**
     * Vérifie que la connexion est ouverte.
     * @throws Si la connexion n'est pas ouverte.
     */
    private ensureOpen(): void {
        if (!this._isOpen || !this.db) {
            throw new Error("MongoDB connection is not open");
        }
    }

    /**
     * Parse une URI de connexion au format `user:password@host:port/database`.
     */
    private parseUri(uri: string): { host: string; port: number; database: string; user: string; password: string } {
        const atIdx = uri.lastIndexOf("@");
        let user = "";
        let password = "";
        let hostPart: string;

        if (atIdx !== -1) {
            const credentials = uri.substring(0, atIdx);
            hostPart = uri.substring(atIdx + 1);
            const colonIdx = credentials.indexOf(":");
            if (colonIdx !== -1) {
                user = credentials.substring(0, colonIdx);
                password = credentials.substring(colonIdx + 1);
            }
            else {
                user = credentials;
            }
        }
        else {
            hostPart = uri;
        }

        const slashIdx = hostPart.indexOf("/");
        let hostAndPort: string;
        let database: string;
        if (slashIdx !== -1) {
            hostAndPort = hostPart.substring(0, slashIdx);
            database = hostPart.substring(slashIdx + 1);
        }
        else {
            hostAndPort = hostPart;
            database = "test";
        }

        const portIdx = hostAndPort.lastIndexOf(":");
        let host: string;
        let port: number;
        if (portIdx !== -1) {
            host = hostAndPort.substring(0, portIdx);
            port = Number.parseInt(hostAndPort.substring(portIdx + 1), 10);
        }
        else {
            host = hostAndPort;
            port = 27017;
        }

        return { host, port, database, user, password };
    }

    /**
     * Convertit un identifiant numérique en ObjectId.
     * En réalité, l'`_id` peut être n'importe quel type dans MongoDB,
     * on tente d'abord un ObjectId, sinon on utilise la valeur brute.
     */
    private toObjectId(id: unknown): ObjectId {
        if (id instanceof ObjectId) {
            return id;
        }
        const str = String(id);
        if (ObjectId.isValid(str) && new ObjectId(str).toString() === str) {
            return new ObjectId(str);
        }
        return id as ObjectId;
    }

    /**
     * Convertit un document MongoDB en DbRecord plat.
     * Convertit les ObjectId en string.
     */
    private docToRecord(doc: Record<string, unknown>): DbRecord {
        const record: DbRecord = {};
        for (const [key, value] of Object.entries(doc)) {
            record[key] = value instanceof ObjectId ? value.toString() : value;
        }
        // Mapper _id comme rowid pour le renderer (tracking Angular + sélection)
        if (record["_id"] !== undefined) {
            record["rowid"] = record["_id"];
        }
        return record;
    }

    /**
     * Infère le type BSON à partir d'une valeur JavaScript.
     */
    private inferBsonType(value: unknown): string {
        if (value === null || value === undefined) {
            return "Null";
        }
        if (value instanceof ObjectId) {
            return "ObjectId";
        }
        if (typeof value === "string") {
            return "String";
        }
        if (typeof value === "number") {
            return Number.isInteger(value) ? "Int32" : "Double";
        }
        if (typeof value === "boolean") {
            return "Boolean";
        }
        if (value instanceof Date) {
            return "Date";
        }
        if (Array.isArray(value)) {
            return "Array";
        }
        if (typeof value === "object") {
            return "Object";
        }
        return "Unknown";
    }

    /**
     * Parse du CSV basique en tableau de records.
     */
    private parseCsv(data: string): Record<string, unknown>[] {
        const lines = data.split("\n").filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            return [];
        }

        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        const records: Record<string, unknown>[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
            const record: Record<string, unknown> = {};
            for (let j = 0; j < headers.length; j++) {
                record[headers[j]] = values[j] ?? null;
            }
            records.push(record);
        }

        return records;
    }
}
