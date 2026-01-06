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
import { WriteBuffer } from "../primitives/buffer";
import { BoolCodec } from "./boolean";
import { Codec } from "./ifaces";
import { Int16Codec, Int32Codec, Int64Codec, Float32Codec, Float64Codec, } from "./numbers";
import { BigIntCodec, DecimalStringCodec } from "./numerics";
import { StrCodec } from "./text";
import { UUIDCodec } from "./uuid";
import { BytesCodec } from "./bytes";
import { JSONCodec, PgTextJSONCodec } from "./json";
import { DateTimeCodec, LocalDateCodec, LocalDateTimeCodec, LocalTimeCodec, DurationCodec, RelativeDurationCodec, DateDurationCodec, } from "./datetime";
import { ConfigMemoryCodec } from "./memory";
import { PgVectorCodec, PgVectorHalfVecCodec, PgVectorSparseVecCodec, } from "./pgvector";
import { PostgisBox2dCodec, PostgisBox3dCodec, PostgisGeometryCodec, } from "./postgis";
import { InternalClientError } from "../errors";
import { INVALID_CODEC_ID, KNOWN_TYPENAMES, NULL_CODEC_ID } from "./consts";
export class NullCodec extends Codec {
    static BUFFER = new WriteBuffer().writeInt32(0).unwrap();
    encode(_buf, _object) {
        throw new InternalClientError("null codec cannot used to encode data");
    }
    decode(_buf, _ctx) {
        throw new InternalClientError("null codec cannot used to decode data");
    }
    getSubcodecs() {
        return [];
    }
    getKind() {
        return "scalar";
    }
}
export const SCALAR_CODECS = new Map();
export const NULL_CODEC = new NullCodec(NULL_CODEC_ID);
export const INVALID_CODEC = new NullCodec(INVALID_CODEC_ID);
function registerScalarCodecs(codecs) {
    for (const [typename, type] of Object.entries(codecs)) {
        const id = KNOWN_TYPENAMES.get(typename);
        if (id == null) {
            throw new InternalClientError("unknown type name");
        }
        SCALAR_CODECS.set(id, new type(id, typename));
    }
}
registerScalarCodecs({
    "std::int16": Int16Codec,
    "std::int32": Int32Codec,
    "std::int64": Int64Codec,
    "std::float32": Float32Codec,
    "std::float64": Float64Codec,
    "std::bigint": BigIntCodec,
    "std::decimal": DecimalStringCodec,
    "std::bool": BoolCodec,
    "std::json": JSONCodec,
    "std::str": StrCodec,
    "std::bytes": BytesCodec,
    "std::uuid": UUIDCodec,
    "cal::local_date": LocalDateCodec,
    "cal::local_time": LocalTimeCodec,
    "cal::local_datetime": LocalDateTimeCodec,
    "std::datetime": DateTimeCodec,
    "std::duration": DurationCodec,
    "cal::relative_duration": RelativeDurationCodec,
    "cal::date_duration": DateDurationCodec,
    "cfg::memory": ConfigMemoryCodec,
    "std::pg::json": PgTextJSONCodec,
    "std::pg::timestamptz": DateTimeCodec,
    "std::pg::timestamp": LocalDateTimeCodec,
    "std::pg::date": LocalDateCodec,
    "std::pg::interval": RelativeDurationCodec,
    "ext::pgvector::vector": PgVectorCodec,
    "ext::pgvector::halfvec": PgVectorHalfVecCodec,
    "ext::pgvector::sparsevec": PgVectorSparseVecCodec,
    "ext::postgis::geometry": PostgisGeometryCodec,
    "ext::postgis::geography": PostgisGeometryCodec,
    "ext::postgis::box2d": PostgisBox2dCodec,
    "ext::postgis::box3d": PostgisBox3dCodec,
});
