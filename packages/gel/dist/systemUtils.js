import * as crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import * as readline from "node:readline";
import { Writable } from "node:stream";
export async function readFileUtf8(...pathParts) {
    return await fs.readFile(path.join(...pathParts), { encoding: "utf8" });
}
export function hasFSReadPermission() {
    if (typeof Deno !== "undefined") {
        return Deno.permissions.querySync({ name: "read" }).state === "granted";
    }
    return true;
}
export function hashSHA1toHex(msg) {
    return crypto.createHash("sha1").update(msg).digest("hex");
}
export async function walk(dir, params) {
    const { match, skip = [] } = params || {};
    try {
        await fs.access(dir);
    }
    catch (_err) {
        return [];
    }
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const fspath = path.resolve(dir, dirent.name);
        if (skip) {
            if (skip.some((re) => re.test(fspath))) {
                return [];
            }
        }
        if (dirent.isDirectory()) {
            return walk(fspath, params);
        }
        if (match) {
            if (!match.some((re) => re.test(fspath))) {
                return [];
            }
        }
        return [fspath];
    }));
    return Array.prototype.concat(...files);
}
export async function exists(filepath) {
    try {
        await fs.access(filepath);
        return true;
    }
    catch {
        return false;
    }
}
export async function input(message, params) {
    let silent = false;
    const output = params?.silent
        ? new Writable({
            write(chunk, encoding, callback) {
                if (!silent)
                    process.stdout.write(chunk, encoding);
                callback();
            },
        })
        : process.stdout;
    const rl = readline.createInterface({
        input: process.stdin,
        output,
    });
    return new Promise((resolve) => {
        rl.question(message, (val) => {
            rl.close();
            resolve(val);
        });
        silent = true;
    });
}
