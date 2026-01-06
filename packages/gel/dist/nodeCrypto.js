import crypto from "node:crypto";
function makeKey(keyBytes) {
    return Promise.resolve(keyBytes);
}
function randomBytes(size) {
    return crypto.randomBytes(size);
}
async function H(msg) {
    const sign = crypto.createHash("sha256");
    sign.update(msg);
    return sign.digest();
}
async function HMAC(key, msg) {
    const cryptoKey = key instanceof Uint8Array ? key : crypto.KeyObject.from(key);
    const hm = crypto.createHmac("sha256", cryptoKey);
    hm.update(msg);
    return hm.digest();
}
export const cryptoUtils = {
    makeKey,
    randomBytes,
    H,
    HMAC,
};
