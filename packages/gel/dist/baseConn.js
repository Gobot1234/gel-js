/*!
 * This source file is part of the Gel open source project.
 *
 * Copyright 2019-present MagicStack Inc. and the Gel authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { INVALID_CODEC, NullCodec, NULL_CODEC } from "./codecs/codecs";
import { ObjectCodec } from "./codecs/object";
import { versionGreaterThan, versionGreaterThanOrEqual } from "./utils";
import * as errors from "./errors";
import { resolveErrorCode, errorFromJSON } from "./errors/resolve";
import { NOOP_CODEC_CONTEXT } from "./codecs/context";
import { Cardinality, OutputFormat, Language } from "./ifaces";
import { ReadBuffer, ReadMessageBuffer, utf8Decoder, WriteBuffer, WriteMessageBuffer, } from "./primitives/buffer";
import * as chars from "./primitives/chars";
import Event from "./primitives/event";
import LRU from "./primitives/lru";
import { IsolationLevel, Options } from "./options";
export const PROTO_VER = [3, 0];
export const PROTO_VER_MIN = [0, 9];
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus[TransactionStatus["TRANS_IDLE"] = 0] = "TRANS_IDLE";
    TransactionStatus[TransactionStatus["TRANS_ACTIVE"] = 1] = "TRANS_ACTIVE";
    TransactionStatus[TransactionStatus["TRANS_INTRANS"] = 2] = "TRANS_INTRANS";
    TransactionStatus[TransactionStatus["TRANS_INERROR"] = 3] = "TRANS_INERROR";
    TransactionStatus[TransactionStatus["TRANS_UNKNOWN"] = 4] = "TRANS_UNKNOWN";
})(TransactionStatus || (TransactionStatus = {}));
export var Capabilities;
(function (Capabilities) {
    Capabilities[Capabilities["NONE"] = 0] = "NONE";
    Capabilities[Capabilities["MODIFICATONS"] = 1] = "MODIFICATONS";
    Capabilities[Capabilities["SESSION_CONFIG"] = 2] = "SESSION_CONFIG";
    Capabilities[Capabilities["TRANSACTION"] = 4] = "TRANSACTION";
    Capabilities[Capabilities["DDL"] = 8] = "DDL";
    Capabilities[Capabilities["PERSISTENT_CONFIG"] = 16] = "PERSISTENT_CONFIG";
    Capabilities[Capabilities["SET_GLOBAL"] = 32] = "SET_GLOBAL";
    Capabilities[Capabilities["ALL"] = 4294967295] = "ALL";
})(Capabilities || (Capabilities = {}));
const NO_TRANSACTION_CAPABILITIES = (Capabilities.ALL & ~Capabilities.TRANSACTION) >>> 0;
const NO_TRANSACTION_CAPABILITIES_BYTES = new Uint8Array(Array(8).fill(255));
new DataView(NO_TRANSACTION_CAPABILITIES_BYTES.buffer).setUint32(4, NO_TRANSACTION_CAPABILITIES);
export const RESTRICTED_CAPABILITIES = (Capabilities.ALL &
    ~Capabilities.TRANSACTION &
    ~Capabilities.SESSION_CONFIG &
    ~Capabilities.SET_GLOBAL) >>>
    0;
var CompilationFlag;
(function (CompilationFlag) {
    CompilationFlag[CompilationFlag["INJECT_OUTPUT_TYPE_IDS"] = 1] = "INJECT_OUTPUT_TYPE_IDS";
    CompilationFlag[CompilationFlag["INJECT_OUTPUT_TYPE_NAMES"] = 2] = "INJECT_OUTPUT_TYPE_NAMES";
    CompilationFlag[CompilationFlag["INJECT_OUTPUT_OBJECT_IDS"] = 4] = "INJECT_OUTPUT_OBJECT_IDS";
})(CompilationFlag || (CompilationFlag = {}));
const OLD_ERROR_CODES = new Map([
    [0x05_03_00_01, 0x05_03_01_01],
    [0x05_03_00_02, 0x05_03_01_02],
]);
export class BaseRawConnection {
    connected = false;
    lastStatus;
    codecsRegistry;
    queryCodecCache;
    serverSecret;
    serverSettings;
    serverXactStatus;
    buffer;
    messageWaiter;
    connWaiter;
    connAbortWaiter;
    _abortedWith = null;
    protocolVersion = PROTO_VER;
    stateCodec = INVALID_CODEC;
    stateCache = new WeakMap();
    lastStateUpdate = null;
    adminUIMode = false;
    constructor(registry) {
        this.buffer = new ReadMessageBuffer();
        this.codecsRegistry = registry;
        this.queryCodecCache = new LRU({ capacity: 1000 });
        this.lastStatus = null;
        this.serverSecret = null;
        this.serverSettings = {};
        this.serverXactStatus = TransactionStatus.TRANS_UNKNOWN;
        this.messageWaiter = null;
        this.connWaiter = new Event();
        this.connAbortWaiter = new Event();
    }
    throwNotImplemented(method) {
        throw new errors.InternalClientError(`method ${method} is not implemented`);
    }
    async _waitForMessage() {
        this.throwNotImplemented("_waitForMessage");
    }
    _sendData(_data) {
        this.throwNotImplemented("_sendData");
    }
    getConnAbortError() {
        return (this._abortedWith ?? new errors.InterfaceError(`client has been closed`));
    }
    _checkState() {
        if (this.isClosed()) {
            throw this.getConnAbortError();
        }
    }
    _abortWithError(err) {
        this._abortedWith = err;
        this._abort();
    }
    _ignoreHeaders() {
        let numFields = this.buffer.readInt16();
        while (numFields) {
            this.buffer.readInt16();
            this.buffer.readLenPrefixedBuffer();
            numFields--;
        }
    }
    _readHeaders() {
        const numFields = this.buffer.readInt16();
        const headers = {};
        for (let i = 0; i < numFields; i++) {
            const key = this.buffer.readString();
            const value = this.buffer.readString();
            headers[key] = value;
        }
        return headers;
    }
    _abortWaiters(err) {
        if (!this.connWaiter.done) {
            this.connWaiter.setError(err);
        }
        this.messageWaiter?.setError(err);
        this.messageWaiter = null;
    }
    _parseHeaders() {
        const ret = new Map();
        let numFields = this.buffer.readInt16();
        while (numFields) {
            const key = this.buffer.readInt16();
            const value = this.buffer.readLenPrefixedBuffer();
            ret.set(key, value);
            numFields--;
        }
        return ret;
    }
    _parseDescribeTypeMessage(query) {
        let capabilities = -1;
        let warnings = [];
        let unsafeIsolationDangers = [];
        const headers = this._readHeaders();
        if (headers.warnings != null) {
            warnings = JSON.parse(headers.warnings).map((warning) => {
                const err = errorFromJSON(warning);
                err._query = query;
                return err;
            });
        }
        if (headers.unsafe_isolation_dangers != null) {
            unsafeIsolationDangers = JSON.parse(headers.unsafe_isolation_dangers).map((danger) => {
                const err = errorFromJSON(danger);
                err._query = query;
                return err;
            });
        }
        capabilities = Number(this.buffer.readBigInt64());
        const cardinality = this.buffer.readChar();
        const inTypeId = this.buffer.readUUID();
        const inTypeData = this.buffer.readLenPrefixedBuffer();
        const outTypeId = this.buffer.readUUID();
        const outTypeData = this.buffer.readLenPrefixedBuffer();
        this.buffer.finishMessage();
        let inCodec = this.codecsRegistry.getCodec(inTypeId);
        if (inCodec == null) {
            inCodec = this.codecsRegistry.buildCodec(inTypeData, this.protocolVersion);
        }
        let outCodec = this.codecsRegistry.getCodec(outTypeId);
        if (outCodec == null) {
            outCodec = this.codecsRegistry.buildCodec(outTypeData, this.protocolVersion);
        }
        return [
            cardinality,
            inCodec,
            outCodec,
            capabilities,
            inTypeData,
            outTypeData,
            warnings,
            unsafeIsolationDangers,
        ];
    }
    _parseCommandCompleteMessage() {
        this._ignoreHeaders();
        this.buffer.readBigInt64();
        const status = this.buffer.readString();
        const stateTypeId = this.buffer.readUUID();
        const stateData = this.buffer.readLenPrefixedBuffer();
        if (this.adminUIMode && stateTypeId === this.stateCodec.tid) {
            this.lastStateUpdate = this.stateCodec.decode(new ReadBuffer(stateData), NOOP_CODEC_CONTEXT);
        }
        this.buffer.finishMessage();
        return status;
    }
    _parseErrorMessage() {
        this.buffer.readChar();
        const code = this.buffer.readUInt32();
        const message = this.buffer.readString();
        const errorType = resolveErrorCode(OLD_ERROR_CODES.get(code) ?? code);
        const err = new errorType(message);
        err._attrs = this._parseHeaders();
        this.buffer.finishMessage();
        if (err instanceof errors.AuthenticationError) {
            throw err;
        }
        return err;
    }
    _parseSyncMessage() {
        this._parseHeaders();
        const status = this.buffer.readChar();
        switch (status) {
            case chars.$I:
                this.serverXactStatus = TransactionStatus.TRANS_IDLE;
                break;
            case chars.$T:
                this.serverXactStatus = TransactionStatus.TRANS_INTRANS;
                break;
            case chars.$E:
                this.serverXactStatus = TransactionStatus.TRANS_INERROR;
                break;
            default:
                this.serverXactStatus = TransactionStatus.TRANS_UNKNOWN;
        }
        this.buffer.finishMessage();
    }
    _redirectDataMessages(result) {
        const $D = chars.$D;
        const buffer = this.buffer;
        while (buffer.takeMessageType($D)) {
            const msg = buffer.consumeMessage();
            result.writeChar($D);
            result.writeInt32(msg.length + 4);
            result.writeBuffer(msg);
        }
    }
    _parseDataMessages(codec, result, ctx) {
        const frb = ReadBuffer.alloc();
        const $D = chars.$D;
        const buffer = this.buffer;
        if (Array.isArray(result)) {
            while (buffer.takeMessageType($D)) {
                buffer.consumeMessageInto(frb);
                frb.discard(6);
                result.push(codec.decode(frb, ctx));
                frb.finish();
            }
        }
        else {
            this._redirectDataMessages(result);
        }
    }
    _parseServerSettings(name, value) {
        switch (name) {
            case "suggested_pool_concurrency": {
                this.serverSettings.suggested_pool_concurrency = parseInt(utf8Decoder.decode(value), 10);
                break;
            }
            case "system_config": {
                const buf = new ReadBuffer(value);
                const typedescLen = buf.readInt32() - 16;
                const typedescId = buf.readUUID();
                const typedesc = buf.readBuffer(typedescLen);
                let codec = this.codecsRegistry.getCodec(typedescId);
                if (codec === null) {
                    codec = this.codecsRegistry.buildCodec(typedesc, this.protocolVersion);
                }
                buf.discard(4);
                const data = codec.decode(buf, NOOP_CODEC_CONTEXT);
                buf.finish();
                this.serverSettings.system_config = data;
                break;
            }
            default:
                this.serverSettings[name] = value;
                break;
        }
    }
    _parseDescribeStateMessage() {
        const typedescId = this.buffer.readUUID();
        const typedesc = this.buffer.readBuffer(this.buffer.readInt32());
        let codec = this.codecsRegistry.getCodec(typedescId);
        if (codec === null) {
            codec = this.codecsRegistry.buildCodec(typedesc, this.protocolVersion);
        }
        this.stateCodec = codec;
        this.stateCache = new WeakMap();
        this.buffer.finishMessage();
    }
    _fallthrough() {
        const mtype = this.buffer.getMessageType();
        switch (mtype) {
            case chars.$S: {
                const name = this.buffer.readString();
                const value = this.buffer.readLenPrefixedBuffer();
                this._parseServerSettings(name, value);
                this.buffer.finishMessage();
                break;
            }
            case chars.$L: {
                const severity = this.buffer.readChar();
                const code = this.buffer.readUInt32();
                const message = this.buffer.readString();
                this._parseHeaders();
                this.buffer.finishMessage();
                console.info("SERVER MESSAGE", severity, code, message);
                break;
            }
            default:
                throw new errors.UnexpectedMessageError(`unexpected message type ${mtype} ("${chars.chr(mtype)}")`);
        }
    }
    _encodeArgs(args, inCodec, ctx) {
        if (inCodec === NULL_CODEC) {
            if (args != null) {
                throw new errors.QueryArgumentError(`This query does not contain any query parameters, ` +
                    `but query arguments were provided to the 'query*()' method`);
            }
            return NullCodec.BUFFER;
        }
        if (inCodec instanceof ObjectCodec) {
            return inCodec.encodeArgs(args, ctx);
        }
        throw new errors.ProtocolError("invalid input codec");
    }
    _isInTransaction() {
        return (this.serverXactStatus === TransactionStatus.TRANS_INTRANS ||
            this.serverXactStatus === TransactionStatus.TRANS_ACTIVE);
    }
    _setStateCodec(state) {
        let encodedState = this.stateCache.get(state);
        if (encodedState) {
            return encodedState;
        }
        const buf = new WriteBuffer();
        this.stateCodec.encode(buf, state._serialise(), NOOP_CODEC_CONTEXT);
        encodedState = buf.unwrap();
        this.stateCache.set(state, encodedState);
        return encodedState;
    }
    _encodeParseParams(wb, query, outputFormat, expectedCardinality, state, capabilitiesFlags, options, language, isExecute, unsafeIsolationDangers) {
        if (versionGreaterThanOrEqual(this.protocolVersion, [3, 0])) {
            if (state.annotations.size >= 1 << 16) {
                throw new errors.InternalClientError("too many annotations");
            }
            wb.writeUInt16(state.annotations.size);
            for (const [name, value] of state.annotations) {
                wb.writeString(name);
                wb.writeString(value);
            }
        }
        else {
            wb.writeUInt16(0);
        }
        wb.writeFlags(0xffff_ffff, capabilitiesFlags);
        wb.writeFlags(0, 0 |
            (options?.injectObjectids
                ? CompilationFlag.INJECT_OUTPUT_OBJECT_IDS
                : 0) |
            (options?.injectTypeids ? CompilationFlag.INJECT_OUTPUT_TYPE_IDS : 0) |
            (options?.injectTypenames
                ? CompilationFlag.INJECT_OUTPUT_TYPE_NAMES
                : 0));
        wb.writeBigInt64(options?.implicitLimit ?? BigInt(0));
        if (versionGreaterThanOrEqual(this.protocolVersion, [3, 0])) {
            wb.writeChar(language);
        }
        wb.writeChar(outputFormat);
        wb.writeChar(expectedCardinality === Cardinality.ONE ||
            expectedCardinality === Cardinality.AT_MOST_ONE
            ? Cardinality.AT_MOST_ONE
            : Cardinality.MANY);
        wb.writeString(query);
        if (!this.adminUIMode && state.isDefaultSession()) {
            wb.writeBuffer(NULL_CODEC.tidBuffer);
            wb.writeInt32(0);
        }
        else {
            wb.writeBuffer(this.stateCodec.tidBuffer);
            if (this.stateCodec === INVALID_CODEC || this.stateCodec === NULL_CODEC) {
                wb.writeInt32(0);
            }
            else {
                if (versionGreaterThanOrEqual(this.protocolVersion, [3, 0]) &&
                    isExecute &&
                    !this._isInTransaction()) {
                    const isolation = state.transactionOptions.isolation ===
                        IsolationLevel.PreferRepeatableRead
                        ?
                            unsafeIsolationDangers.length === 0
                                ? IsolationLevel.RepeatableRead
                                : IsolationLevel.Serializable
                        : state.transactionOptions.isolation;
                    if (isolation !== state.config.get("default_transaction_isolation")) {
                        state = state
                            .withConfig({
                            default_transaction_isolation: isolation,
                        })
                            .withTransactionOptions({
                            isolation,
                        });
                    }
                    if (state.transactionOptions.readonly !==
                        state.config.get("default_transaction_access_mode")) {
                        state = state.withConfig({
                            default_transaction_access_mode: state.transactionOptions.readonly
                                ? "ReadOnly"
                                : "ReadWrite",
                        });
                    }
                }
                const encodedState = this._setStateCodec(state);
                wb.writeBuffer(encodedState);
            }
        }
    }
    async _parse(language, query, outputFormat, expectedCardinality, state, capabilitiesFlags = RESTRICTED_CAPABILITIES, options, unsafeIsolationDangers = []) {
        const wb = new WriteMessageBuffer();
        wb.beginMessage(chars.$P);
        this._encodeParseParams(wb, query, outputFormat, expectedCardinality, state, capabilitiesFlags, options, language, false, unsafeIsolationDangers);
        wb.endMessage();
        wb.writeSync();
        this._sendData(wb.unwrap());
        let parsing = true;
        let error = null;
        let newCard = null;
        let capabilities = -1;
        let inCodec = null;
        let outCodec = null;
        let inCodecBuf = null;
        let outCodecBuf = null;
        let warnings = [];
        while (parsing) {
            if (!this.buffer.takeMessage()) {
                await this._waitForMessage();
            }
            const mtype = this.buffer.getMessageType();
            switch (mtype) {
                case chars.$T: {
                    try {
                        [
                            newCard,
                            inCodec,
                            outCodec,
                            capabilities,
                            inCodecBuf,
                            outCodecBuf,
                            warnings,
                            unsafeIsolationDangers,
                        ] = this._parseDescribeTypeMessage(query);
                        const key = this._getQueryCacheKey(query, outputFormat, expectedCardinality);
                        this.queryCodecCache.set(key, [
                            newCard,
                            inCodec,
                            outCodec,
                            capabilities,
                            unsafeIsolationDangers,
                        ]);
                    }
                    catch (e) {
                        error = e;
                    }
                    break;
                }
                case chars.$E: {
                    error = this._parseErrorMessage();
                    error._query = query;
                    break;
                }
                case chars.$s: {
                    Options.signalSchemaChange();
                    this._parseDescribeStateMessage();
                    break;
                }
                case chars.$Z: {
                    this._parseSyncMessage();
                    parsing = false;
                    break;
                }
                default:
                    this._fallthrough();
            }
        }
        if (error !== null) {
            if (error instanceof errors.StateMismatchError) {
                return this._parse(language, query, outputFormat, expectedCardinality, state, capabilitiesFlags, options, unsafeIsolationDangers);
            }
            throw error;
        }
        return [
            newCard,
            inCodec,
            outCodec,
            capabilities,
            inCodecBuf,
            outCodecBuf,
            warnings,
            unsafeIsolationDangers,
        ];
    }
    async _executeFlow(language, query, args, outputFormat, expectedCardinality, state, inCodec, outCodec, result, capabilitiesFlags = RESTRICTED_CAPABILITIES, options, unsafeIsolationDangers = []) {
        let currentUnsafeIsolationDangers = unsafeIsolationDangers;
        let ctx = state.makeCodecContext();
        const wb = new WriteMessageBuffer();
        wb.beginMessage(chars.$O);
        this._encodeParseParams(wb, query, outputFormat, expectedCardinality, state, capabilitiesFlags, options, language, true, currentUnsafeIsolationDangers);
        wb.writeBuffer(inCodec.tidBuffer);
        wb.writeBuffer(outCodec.tidBuffer);
        if (inCodec) {
            wb.writeBuffer(this._encodeArgs(args, inCodec, ctx));
        }
        else {
            wb.writeInt32(0);
        }
        wb.endMessage();
        wb.writeSync();
        this._sendData(wb.unwrap());
        let error = null;
        let parsing = true;
        let currentWarnings = [];
        while (parsing) {
            if (!this.buffer.takeMessage()) {
                await this._waitForMessage();
            }
            const mtype = this.buffer.getMessageType();
            switch (mtype) {
                case chars.$D: {
                    if (error == null) {
                        try {
                            this._parseDataMessages(outCodec, result, ctx);
                        }
                        catch (e) {
                            error = e;
                            this.buffer.finishMessage();
                        }
                    }
                    else {
                        this.buffer.discardMessage();
                    }
                    break;
                }
                case chars.$C: {
                    this.lastStatus = this._parseCommandCompleteMessage();
                    break;
                }
                case chars.$Z: {
                    this._parseSyncMessage();
                    parsing = false;
                    break;
                }
                case chars.$T: {
                    try {
                        ctx = state.makeCodecContext();
                        const [newCard, newInCodec, newOutCodec, capabilities, _, __, _warnings, _dangers,] = this._parseDescribeTypeMessage(query);
                        if ((outCodec !== NULL_CODEC && outCodec.tid !== newOutCodec.tid) ||
                            (inCodec !== NULL_CODEC && inCodec.tid !== newInCodec.tid)) {
                            Options.signalSchemaChange();
                            ctx = state.makeCodecContext();
                        }
                        const key = this._getQueryCacheKey(query, outputFormat, expectedCardinality);
                        this.queryCodecCache.set(key, [
                            newCard,
                            newInCodec,
                            newOutCodec,
                            capabilities,
                            _dangers,
                        ]);
                        outCodec = newOutCodec;
                        currentWarnings = _warnings;
                        currentUnsafeIsolationDangers = _dangers;
                    }
                    catch (e) {
                        Options.signalSchemaChange();
                        error = e;
                    }
                    break;
                }
                case chars.$s: {
                    Options.signalSchemaChange();
                    this._parseDescribeStateMessage();
                    break;
                }
                case chars.$E: {
                    error = this._parseErrorMessage();
                    error._query = query;
                    break;
                }
                default:
                    this._fallthrough();
            }
        }
        if (error != null) {
            if (error instanceof errors.StateMismatchError) {
                return this._executeFlow(language, query, args, outputFormat, expectedCardinality, state, inCodec, outCodec, result, capabilitiesFlags, options, currentUnsafeIsolationDangers);
            }
            throw error;
        }
        return [currentWarnings, currentUnsafeIsolationDangers];
    }
    _getQueryCacheKey(query, outputFormat, expectedCardinality, language = Language.EDGEQL) {
        const expectOne = expectedCardinality === Cardinality.ONE ||
            expectedCardinality === Cardinality.AT_MOST_ONE;
        return [language, outputFormat, expectOne, query.length, query].join(";");
    }
    _validateFetchCardinality(card, outputFormat, expectedCardinality) {
        if (expectedCardinality === Cardinality.ONE &&
            card === Cardinality.NO_RESULT) {
            throw new errors.NoDataError(`query executed via queryRequiredSingle${outputFormat === OutputFormat.JSON ? "JSON" : ""}() returned no data`);
        }
    }
    async fetch(query, args = null, outputFormat, expectedCardinality, state, privilegedMode = false, language = Language.EDGEQL) {
        if (language !== Language.EDGEQL &&
            versionGreaterThan([3, 0], this.protocolVersion)) {
            throw new errors.UnsupportedFeatureError(`the server does not support SQL queries, upgrade to 6.0 or newer`);
        }
        this._checkState();
        const requiredOne = expectedCardinality === Cardinality.ONE;
        const expectOne = requiredOne || expectedCardinality === Cardinality.AT_MOST_ONE;
        const asJson = outputFormat === OutputFormat.JSON;
        const key = this._getQueryCacheKey(query, outputFormat, expectedCardinality, language);
        const ret = [];
        let warnings = [];
        let [card, inCodec, outCodec, , unsafeIsolationDangers] = this.queryCodecCache.get(key) ?? [];
        if (card) {
            this._validateFetchCardinality(card, outputFormat, expectedCardinality);
        }
        if ((!inCodec && args !== null) ||
            (this.stateCodec === INVALID_CODEC && !state.isDefaultSession())) {
            [card, inCodec, outCodec, , , , warnings, unsafeIsolationDangers] =
                await this._parse(language, query, outputFormat, expectedCardinality, state, privilegedMode ? Capabilities.ALL : undefined, undefined, unsafeIsolationDangers);
            this._validateFetchCardinality(card, outputFormat, expectedCardinality);
        }
        try {
            [warnings, unsafeIsolationDangers] = await this._executeFlow(language, query, args, outputFormat, expectedCardinality, state, inCodec ?? NULL_CODEC, outCodec ?? NULL_CODEC, ret, privilegedMode ? Capabilities.ALL : undefined, undefined, unsafeIsolationDangers);
        }
        catch (e) {
            if (e instanceof errors.ParameterTypeMismatchError) {
                [card, inCodec, outCodec, , unsafeIsolationDangers] =
                    this.queryCodecCache.get(key);
                [warnings, unsafeIsolationDangers] = await this._executeFlow(language, query, args, outputFormat, expectedCardinality, state, inCodec ?? NULL_CODEC, outCodec ?? NULL_CODEC, ret, privilegedMode ? Capabilities.ALL : undefined);
            }
            else {
                throw e;
            }
        }
        if (outputFormat === OutputFormat.NONE) {
            return { result: null, warnings, unsafeIsolationDangers };
        }
        if (expectOne) {
            if (requiredOne && !ret.length) {
                throw new errors.NoDataError("query returned no data");
            }
            else {
                return {
                    result: ret[0] ?? (asJson ? "null" : null),
                    warnings,
                    unsafeIsolationDangers,
                };
            }
        }
        else {
            if (ret && ret.length) {
                if (asJson) {
                    return { result: ret[0], warnings, unsafeIsolationDangers };
                }
                else {
                    return { result: ret, warnings, unsafeIsolationDangers };
                }
            }
            else {
                if (asJson) {
                    return { result: "[]", warnings, unsafeIsolationDangers };
                }
                else {
                    return { result: ret, warnings, unsafeIsolationDangers };
                }
            }
        }
    }
    getQueryCapabilities(query, outputFormat, expectedCardinality) {
        const key = this._getQueryCacheKey(query, outputFormat, expectedCardinality);
        return this.queryCodecCache.get(key)?.[3] ?? null;
    }
    async resetState() {
        if (this.connected &&
            this.serverXactStatus !== TransactionStatus.TRANS_IDLE) {
            try {
                await this.fetch(`rollback`, undefined, OutputFormat.NONE, Cardinality.NO_RESULT, Options.defaults(), true);
            }
            catch {
                this._abortWithError(new errors.ClientConnectionClosedError("failed to reset state"));
            }
        }
    }
    _abort() {
        this.connected = false;
        this._abortWaiters(this.getConnAbortError());
        if (!this.connAbortWaiter.done) {
            this.connAbortWaiter.set();
        }
    }
    isClosed() {
        return !this.connected;
    }
    async close() {
        this._abort();
    }
}
