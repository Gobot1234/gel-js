import { ProtocolError } from "./errors";
import { decodeB64, encodeB64, utf8Decoder, utf8Encoder, } from "./primitives/buffer";
import { getSCRAM } from "./scram";
const AUTH_ENDPOINT = "/auth/token";
export function getHTTPSCRAMAuth(cryptoUtils) {
    const { bufferEquals, generateNonce, buildClientFirstMessage, buildClientFinalMessage, parseServerFirstMessage, parseServerFinalMessage, } = getSCRAM(cryptoUtils);
    return async function HTTPSCRAMAuth(baseUrl, username, password) {
        const authUrl = baseUrl + AUTH_ENDPOINT;
        const clientNonce = generateNonce();
        const [clientFirst, clientFirstBare] = buildClientFirstMessage(clientNonce, username);
        const serverFirstRes = await fetch(authUrl, {
            headers: {
                Authorization: `SCRAM-SHA-256 data=${utf8ToB64(clientFirst)}`,
            },
        });
        const authenticateHeader = serverFirstRes.headers.get("WWW-Authenticate");
        if (serverFirstRes.status !== 401 || !authenticateHeader) {
            const body = await serverFirstRes.text();
            throw new ProtocolError(`authentication failed: ${body}`);
        }
        if (!authenticateHeader.startsWith("SCRAM-SHA-256")) {
            throw new ProtocolError(`unsupported authentication scheme: ${authenticateHeader}`);
        }
        const authParams = authenticateHeader.split(/ (.+)?/, 2)[1] ?? "";
        if (authParams.length === 0) {
            const body = await serverFirstRes.text();
            throw new ProtocolError(`authentication failed: ${body}`);
        }
        const { sid, data: serverFirst } = parseScramAttrs(authParams);
        if (!sid || !serverFirst) {
            throw new ProtocolError(`authentication challenge missing attributes: expected "sid" and "data", got '${authParams}'`);
        }
        const [serverNonce, salt, iterCount] = parseServerFirstMessage(serverFirst);
        const [clientFinal, expectedServerSig] = await buildClientFinalMessage(password, salt, iterCount, clientFirstBare, serverFirst, serverNonce);
        const serverFinalRes = await fetch(authUrl, {
            headers: {
                Authorization: `SCRAM-SHA-256 sid=${sid}, data=${utf8ToB64(clientFinal)}`,
            },
        });
        const authInfoHeader = serverFinalRes.headers.get("Authentication-Info");
        if (!serverFinalRes.ok || !authInfoHeader) {
            const body = await serverFinalRes.text();
            throw new ProtocolError(`authentication failed: ${body}`);
        }
        const { data: serverFinal, sid: sidFinal } = parseScramAttrs(authInfoHeader);
        if (!sidFinal || !serverFinal) {
            throw new ProtocolError(`authentication info missing attributes: expected "sid" and "data", got '${authInfoHeader}'`);
        }
        if (sidFinal !== sid) {
            throw new ProtocolError("SCRAM session id does not match");
        }
        const serverSig = parseServerFinalMessage(serverFinal);
        if (!bufferEquals(serverSig, expectedServerSig)) {
            throw new ProtocolError("server SCRAM proof does not match");
        }
        const authToken = await serverFinalRes.text();
        return authToken;
    };
}
function utf8ToB64(str) {
    return encodeB64(utf8Encoder.encode(str));
}
function b64ToUtf8(str) {
    return utf8Decoder.decode(decodeB64(str));
}
function parseScramAttrs(paramsStr) {
    const params = new Map(paramsStr.length > 0
        ? paramsStr
            .split(",")
            .map((attr) => attr.split(/=(.+)?/, 2))
            .map(([key, val]) => [key.trim(), val.trim()])
        : []);
    const sid = params.get("sid") ?? null;
    const rawData = params.get("data");
    const data = rawData ? b64ToUtf8(rawData) : null;
    return { sid, data };
}
