import { cryptoUtils as browserCryptoUtils } from "./browserCrypto";
const isNode = typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null;
let cryptoUtils;
function loadCrypto() {
    if (isNode) {
        try {
            require("node:crypto");
            cryptoUtils = require("./nodeCrypto").cryptoUtils;
        }
        catch (_) {
            if (typeof globalThis.crypto !== "undefined") {
                cryptoUtils = browserCryptoUtils;
            }
            else {
                throw new Error("No crypto implementation found");
            }
        }
    }
    else {
        cryptoUtils = browserCryptoUtils;
    }
}
loadCrypto();
export default cryptoUtils;
