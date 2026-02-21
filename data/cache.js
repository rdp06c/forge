// File-based JSON cache with TTL — replaces APEX's localStorage caching
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = join(import.meta.dirname, '..', 'cache');

export class FileCache {
    constructor() {
        if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    }

    _path(key) {
        return join(CACHE_DIR, `${key}.json`);
    }

    get(key, ttlMs) {
        const filePath = this._path(key);
        if (!existsSync(filePath)) return null;
        try {
            const raw = JSON.parse(readFileSync(filePath, 'utf8'));
            if (ttlMs && Date.now() - raw._ts > ttlMs) return null;
            return raw.data;
        } catch {
            return null;
        }
    }

    set(key, data) {
        try {
            writeFileSync(this._path(key), JSON.stringify({ _ts: Date.now(), data }));
        } catch (e) {
            console.warn(`Cache write failed for ${key}:`, e.message);
        }
    }

    clear(key) {
        try {
            const filePath = this._path(key);
            if (existsSync(filePath)) unlinkSync(filePath);
        } catch { /* ignore */ }
    }
}

export const cache = new FileCache();
