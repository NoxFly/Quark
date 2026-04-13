export function readFileAsync(file: File): Promise<string> {
    const reader = new FileReader();
    reader.readAsText(file);

    return new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
    });
}

export function readJsonFileAsync<T = any>(file: File): Promise<T> {
    return readFileAsync(file).then((content) => jsonParse(content));
}

export function jsonParse<T = any>(data: string): T {
    return JSON.parse(data);
}

export function jsonParseSafe<T = unknown>(data: string | null | undefined): T | undefined {
    if (data == null) {
        return undefined; // uniquement null/undefined, pas les falsy
    }

    try {
        return JSON.parse(data) as T;
    } catch {
        return undefined;
    }
}

export function deepCopy<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

export function prettyDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}


export function getDate(date?: Date): string {
    if (!date) {
        return "0001-01-01";
    }

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
}
