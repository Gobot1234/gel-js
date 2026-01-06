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
import { Codec } from "./ifaces";
import { WriteBuffer, ReadBuffer } from "../primitives/buffer";
import { MultiRange, Range } from "../datatypes/range";
import { InvalidArgumentError, ProtocolError } from "../errors";
var RangeFlags;
(function (RangeFlags) {
    RangeFlags[RangeFlags["EMPTY"] = 1] = "EMPTY";
    RangeFlags[RangeFlags["INC_LOWER"] = 2] = "INC_LOWER";
    RangeFlags[RangeFlags["INC_UPPER"] = 4] = "INC_UPPER";
    RangeFlags[RangeFlags["EMPTY_LOWER"] = 8] = "EMPTY_LOWER";
    RangeFlags[RangeFlags["EMPTY_UPPER"] = 16] = "EMPTY_UPPER";
})(RangeFlags || (RangeFlags = {}));
const MAXINT32 = 0x7fffffff;
function encodeRange(buf, obj, subCodec, ctx) {
    if (!(obj instanceof Range)) {
        throw new InvalidArgumentError("a Range was expected");
    }
    const elemData = new WriteBuffer();
    if (obj.lower !== null) {
        subCodec.encode(elemData, obj.lower, ctx);
    }
    if (obj.upper !== null) {
        subCodec.encode(elemData, obj.upper, ctx);
    }
    const elemBuf = elemData.unwrap();
    buf.writeInt32(1 + elemBuf.length);
    buf.writeUInt8(obj.isEmpty
        ? RangeFlags.EMPTY
        : (obj.incLower ? RangeFlags.INC_LOWER : 0) |
            (obj.incUpper ? RangeFlags.INC_UPPER : 0) |
            (obj.lower === null ? RangeFlags.EMPTY_LOWER : 0) |
            (obj.upper === null ? RangeFlags.EMPTY_UPPER : 0));
    buf.writeBuffer(elemBuf);
}
function decodeRange(buf, subCodec, ctx) {
    const flags = buf.readUInt8();
    if (flags & RangeFlags.EMPTY) {
        return Range.empty();
    }
    const elemBuf = ReadBuffer.alloc();
    let lower = null;
    let upper = null;
    if (!(flags & RangeFlags.EMPTY_LOWER)) {
        buf.sliceInto(elemBuf, buf.readInt32());
        lower = subCodec.decode(elemBuf, ctx);
        elemBuf.finish();
    }
    if (!(flags & RangeFlags.EMPTY_UPPER)) {
        buf.sliceInto(elemBuf, buf.readInt32());
        upper = subCodec.decode(elemBuf, ctx);
        elemBuf.finish();
    }
    return new Range(lower, upper, !!(flags & RangeFlags.INC_LOWER), !!(flags & RangeFlags.INC_UPPER));
}
export class RangeCodec extends Codec {
    tsType = "Range";
    tsModule = "gel";
    subCodec;
    typeName;
    constructor(tid, typeName, subCodec) {
        super(tid);
        this.subCodec = subCodec;
        this.typeName = typeName;
    }
    encode(buf, obj, ctx) {
        return encodeRange(buf, obj, this.subCodec, ctx);
    }
    decode(buf, ctx) {
        return decodeRange(buf, this.subCodec, ctx);
    }
    getSubcodecs() {
        return [this.subCodec];
    }
    getKind() {
        return "range";
    }
}
export class MultiRangeCodec extends Codec {
    tsType = "MultiRange";
    tsModule = "gel";
    subCodec;
    typeName;
    constructor(tid, typeName, subCodec) {
        super(tid);
        this.subCodec = subCodec;
        this.typeName = typeName;
    }
    encode(buf, obj, ctx) {
        if (!(obj instanceof MultiRange)) {
            throw new TypeError(`a MultiRange expected (got type ${obj.constructor.name})`);
        }
        const objLen = obj.length;
        if (objLen > MAXINT32) {
            throw new InvalidArgumentError("too many elements in array");
        }
        const elemData = new WriteBuffer();
        for (const item of obj) {
            try {
                encodeRange(elemData, item, this.subCodec, ctx);
            }
            catch (e) {
                if (e instanceof InvalidArgumentError) {
                    throw new InvalidArgumentError(`invalid multirange element: ${e.message}`);
                }
                else {
                    throw e;
                }
            }
        }
        const elemBuf = elemData.unwrap();
        const elemDataLen = elemBuf.length;
        if (elemDataLen > MAXINT32 - 4) {
            throw new InvalidArgumentError(`size of encoded multirange datum exceeds the maximum allowed ${MAXINT32 - 4} bytes`);
        }
        buf.writeInt32(4 + elemDataLen);
        buf.writeInt32(objLen);
        buf.writeBuffer(elemBuf);
    }
    decode(buf, ctx) {
        const elemCount = buf.readInt32();
        const result = new Array(elemCount);
        const elemBuf = ReadBuffer.alloc();
        const subCodec = this.subCodec;
        for (let i = 0; i < elemCount; i++) {
            const elemLen = buf.readInt32();
            if (elemLen === -1) {
                throw new ProtocolError("unexpected NULL element in multirange value");
            }
            else {
                buf.sliceInto(elemBuf, elemLen);
                const elem = decodeRange(elemBuf, subCodec, ctx);
                if (elemBuf.length) {
                    throw new ProtocolError(`unexpected trailing data in buffer after multirange element decoding: ${elemBuf.length}`);
                }
                result[i] = elem;
                elemBuf.finish();
            }
        }
        return new MultiRange(result);
    }
    getSubcodecs() {
        return [this.subCodec];
    }
    getKind() {
        return "multirange";
    }
}
