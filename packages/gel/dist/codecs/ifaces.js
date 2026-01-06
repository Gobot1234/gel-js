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
import { uuidToBuffer, } from "../primitives/buffer";
import { KNOWN_TYPES } from "./consts";
export class Codec {
    tid;
    tidBuffer;
    constructor(tid) {
        this.tid = tid;
        this.tidBuffer = uuidToBuffer(tid);
    }
    getKnownTypeName() {
        return "anytype";
    }
}
export class ScalarCodec extends Codec {
    typeName;
    ancestors = null;
    constructor(tid, typeName) {
        super(tid);
        this.typeName = typeName;
    }
    derive(tid, typeName, ancestors) {
        const self = this.constructor;
        const codec = new self(tid, typeName);
        codec.ancestors = ancestors;
        return codec;
    }
    getSubcodecs() {
        return [];
    }
    getKind() {
        return "scalar";
    }
    tsType = "unknown";
    tsModule = null;
    getKnownTypeName() {
        if (this.typeName) {
            return this.typeName;
        }
        return KNOWN_TYPES.get(this.tid) || "anytype";
    }
}
