/*!
 * This source file is part of the Gel open source project.
 *
 * Copyright 2020-present MagicStack Inc. and the Gel authors.
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
import * as chars from "./primitives/chars";
export var OutputFormat;
(function (OutputFormat) {
    OutputFormat[OutputFormat["BINARY"] = chars.$b] = "BINARY";
    OutputFormat[OutputFormat["JSON"] = chars.$j] = "JSON";
    OutputFormat[OutputFormat["NONE"] = chars.$n] = "NONE";
})(OutputFormat || (OutputFormat = {}));
export var Cardinality;
(function (Cardinality) {
    Cardinality[Cardinality["NO_RESULT"] = chars.$n] = "NO_RESULT";
    Cardinality[Cardinality["AT_MOST_ONE"] = chars.$o] = "AT_MOST_ONE";
    Cardinality[Cardinality["ONE"] = chars.$A] = "ONE";
    Cardinality[Cardinality["MANY"] = chars.$m] = "MANY";
    Cardinality[Cardinality["AT_LEAST_ONE"] = chars.$M] = "AT_LEAST_ONE";
})(Cardinality || (Cardinality = {}));
export var Language;
(function (Language) {
    Language[Language["EDGEQL"] = chars.$E] = "EDGEQL";
    Language[Language["SQL"] = chars.$S] = "SQL";
})(Language || (Language = {}));
