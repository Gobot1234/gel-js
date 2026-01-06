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
import { ReadBuffer } from "../primitives/buffer";
import { InternalClientError, InvalidArgumentError, ProtocolError, } from "../errors";
const SQLRowArrayCodec = {
    fromDatabase(values, _desc) {
        return values;
    },
    toDatabase() {
        throw new InternalClientError("cannot encode SQL record as a query argument");
    },
};
const SQLRowObjectCodec = {
    fromDatabase(values, { names }) {
        return Object.fromEntries(names.map((key, index) => [key, values[index]]));
    },
    toDatabase() {
        throw new InternalClientError("cannot encode SQL record as a query argument");
    },
};
export const SQLRowModeArray = {
    _private_sql_row: SQLRowArrayCodec,
};
export const SQLRowModeObject = {
    _private_sql_row: SQLRowObjectCodec,
};
export class RecordCodec extends Codec {
    subCodecs;
    names;
    constructor(tid, codecs, names) {
        super(tid);
        this.subCodecs = codecs;
        this.names = names;
    }
    encode(_buf, _object) {
        throw new InvalidArgumentError("SQL records cannot be passed as arguments");
    }
    decode(buf, ctx) {
        const els = buf.readUInt32();
        const subCodecs = this.subCodecs;
        if (els !== subCodecs.length) {
            throw new ProtocolError(`cannot decode Record: expected ` +
                `${subCodecs.length} elements, got ${els}`);
        }
        const elemBuf = ReadBuffer.alloc();
        const overload = ctx.getContainerOverload("_private_sql_row");
        if (overload != null && overload !== SQLRowObjectCodec) {
            const result = new Array(els);
            for (let i = 0; i < els; i++) {
                buf.discard(4);
                const elemLen = buf.readInt32();
                let val = null;
                if (elemLen !== -1) {
                    buf.sliceInto(elemBuf, elemLen);
                    val = subCodecs[i].decode(elemBuf, ctx);
                    elemBuf.finish();
                }
                result[i] = val;
            }
            if (overload !== SQLRowArrayCodec) {
                return overload.fromDatabase(result, { names: this.names });
            }
            return result;
        }
        else {
            const names = this.names;
            const result = {};
            for (let i = 0; i < els; i++) {
                buf.discard(4);
                const elemLen = buf.readInt32();
                let val = null;
                if (elemLen !== -1) {
                    buf.sliceInto(elemBuf, elemLen);
                    val = subCodecs[i].decode(elemBuf, ctx);
                    elemBuf.finish();
                }
                result[names[i]] = val;
            }
            return result;
        }
    }
    getSubcodecs() {
        return Array.from(this.subCodecs);
    }
    getNames() {
        return Array.from(this.names);
    }
    getKind() {
        return "record";
    }
}
