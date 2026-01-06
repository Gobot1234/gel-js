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
import { utf8Encoder, } from "../primitives/buffer";
import { ScalarCodec } from "./ifaces";
import { InvalidArgumentError, ProtocolError } from "../errors";
export class JSONCodec extends ScalarCodec {
    tsType = "unknown";
    jsonFormat = 1;
    encode(buf, object, ctx) {
        let val;
        if (ctx.hasOverload(this)) {
            val = ctx.preEncode(this, object);
        }
        else {
            try {
                val = JSON.stringify(object);
            }
            catch (_err) {
                throw new InvalidArgumentError(`a JSON-serializable value was expected, got "${object}"`);
            }
        }
        if (typeof val !== "string") {
            throw new InvalidArgumentError(`a JSON-serializable value was expected, got "${object}"`);
        }
        const strbuf = utf8Encoder.encode(val);
        if (this.jsonFormat !== null) {
            buf.writeInt32(strbuf.length + 1);
            buf.writeChar(this.jsonFormat);
        }
        else {
            buf.writeInt32(strbuf.length);
        }
        buf.writeBuffer(strbuf);
    }
    decode(buf, ctx) {
        if (this.jsonFormat !== null) {
            const format = buf.readUInt8();
            if (format !== this.jsonFormat) {
                throw new ProtocolError(`unexpected JSON format ${format}`);
            }
        }
        if (ctx.hasOverload(this)) {
            return ctx.postDecode(this, buf.consumeAsString());
        }
        else {
            return JSON.parse(buf.consumeAsString());
        }
    }
}
export class PgTextJSONCodec extends JSONCodec {
    jsonFormat = null;
}
export class PgTextJSONStringCodec extends ScalarCodec {
    encode(buf, object, ctx) {
        if (ctx.hasOverload(this)) {
            object = ctx.preEncode(this, object);
        }
        if (typeof object !== "string") {
            throw new InvalidArgumentError(`a string was expected, got "${object}"`);
        }
        const strbuf = utf8Encoder.encode(object);
        buf.writeInt32(strbuf.length);
        buf.writeBuffer(strbuf);
    }
    decode(buf, ctx) {
        return ctx.postDecode(this, buf.consumeAsString());
    }
}
