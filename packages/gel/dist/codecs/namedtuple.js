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
import { ReadBuffer, WriteBuffer } from "../primitives/buffer";
import { InvalidArgumentError, MissingArgumentError, ProtocolError, QueryArgumentError, } from "../errors";
export class NamedTupleCodec extends Codec {
    subCodecs;
    names;
    typeName;
    constructor(tid, typeName, codecs, names) {
        super(tid);
        this.subCodecs = codecs;
        this.names = names;
        this.typeName = typeName;
    }
    encode(buf, object, ctx) {
        if (typeof object !== "object" || Array.isArray(object)) {
            throw new InvalidArgumentError(`an object was expected, got "${object}"`);
        }
        const codecsLen = this.subCodecs.length;
        if (Object.keys(object).length !== codecsLen) {
            throw new QueryArgumentError(`expected ${codecsLen} element${codecsLen === 1 ? "" : "s"} in named tuple, got ${Object.keys(object).length}`);
        }
        const elemData = new WriteBuffer();
        for (let i = 0; i < codecsLen; i++) {
            const key = this.names[i];
            const val = object[key];
            if (val == null) {
                throw new MissingArgumentError(`element '${key}' in named tuple cannot be 'null'`);
            }
            else {
                elemData.writeInt32(0);
                try {
                    this.subCodecs[i].encode(elemData, val, ctx);
                }
                catch (e) {
                    if (e instanceof QueryArgumentError) {
                        throw new InvalidArgumentError(`invalid element '${key}' in named tuple: ${e.message}`);
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
        const elemBuf = elemData.unwrap();
        buf.writeInt32(4 + elemBuf.length);
        buf.writeInt32(codecsLen);
        buf.writeBuffer(elemBuf);
    }
    decode(buf, ctx) {
        const els = buf.readUInt32();
        const subCodecs = this.subCodecs;
        if (els !== subCodecs.length) {
            throw new ProtocolError(`cannot decode NamedTuple: expected ` +
                `${subCodecs.length} elements, got ${els}`);
        }
        const elemBuf = ReadBuffer.alloc();
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
    getSubcodecs() {
        return Array.from(this.subCodecs);
    }
    getNames() {
        return Array.from(this.names);
    }
    getKind() {
        return "namedtuple";
    }
}
