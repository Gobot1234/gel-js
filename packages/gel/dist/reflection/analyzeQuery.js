import { ArrayCodec } from "../codecs/array";
import { EnumCodec } from "../codecs/enum";
import { ScalarCodec } from "../codecs/ifaces";
import { NamedTupleCodec } from "../codecs/namedtuple";
import { ObjectCodec } from "../codecs/object";
import { MultiRangeCodec, RangeCodec } from "../codecs/range";
import { NullCodec } from "../codecs/codecs";
import { SetCodec } from "../codecs/set";
import { TupleCodec } from "../codecs/tuple";
import { Cardinality } from "./enums";
import { util } from "./util";
export async function analyzeQuery(client, query, { useResolvedCodecType = false } = {}) {
    const { cardinality, capabilities, in: inCodec, out: outCodec, } = await client.describe(query);
    const generators = useResolvedCodecType
        ? new Map([...defaultCodecGenerators, resolvedCodecTypeScalarTypeGenerator])
        : defaultCodecGenerators;
    const args = generateTSTypeFromCodec(inCodec, Cardinality.One, {
        optionalNulls: true,
        readonly: true,
        generators,
    });
    const result = generateTSTypeFromCodec(outCodec, cardinality, {
        generators,
    });
    const imports = args.imports.merge(result.imports);
    return {
        result: result.type,
        args: args.type,
        cardinality,
        capabilities,
        query,
        importMap: imports,
        imports: imports.get("gel") ?? new Set(),
    };
}
export const generateTSTypeFromCodec = (codec, cardinality = Cardinality.One, options = {}) => {
    const optionsWithDefaults = {
        indent: "",
        optionalNulls: false,
        readonly: false,
        ...options,
    };
    const context = {
        ...optionsWithDefaults,
        generators: defaultCodecGenerators,
        applyCardinality: defaultApplyCardinalityToTsType(optionsWithDefaults),
        ...options,
        imports: new ImportMap(),
        walk: (codec, innerContext) => {
            innerContext ??= context;
            for (const [type, generator] of innerContext.generators) {
                if (codec instanceof type) {
                    return generator(codec, innerContext);
                }
            }
            throw new Error(`Unexpected codec kind: ${codec.getKind()}`);
        },
    };
    const type = context.applyCardinality(context.walk(codec, context), cardinality);
    return {
        type,
        imports: context.imports,
    };
};
const genDef = (codecType, generator) => [codecType, generator];
export { genDef as defineCodecGeneratorTuple };
const getSortPriority = (field) => {
    if (!(field.codec instanceof ObjectCodec)) {
        switch (field.cardinality) {
            case Cardinality.One:
                return 0;
            case Cardinality.AtLeastOne:
                return 1;
            case Cardinality.AtMostOne:
                return 2;
            case Cardinality.Many:
                return 3;
        }
    }
    else {
        switch (field.cardinality) {
            case Cardinality.One:
                return 4;
            case Cardinality.AtLeastOne:
                return 5;
            case Cardinality.AtMostOne:
                return 6;
            case Cardinality.Many:
                return 7;
        }
    }
    return 8;
};
const resolvedCodecTypeScalarTypeGenerator = genDef(ScalarCodec, (codec, ctx) => {
    if (codec.tsModule) {
        ctx.imports.add(codec.tsModule, codec.tsType);
    }
    const isCustomScalar = !codec.typeName.startsWith("std::");
    if (isCustomScalar) {
        ctx.imports.add("gel", "ResolvedCodecType");
        return `ResolvedCodecType<"${codec.typeName}", ${codec.tsType}>`;
    }
    return codec.tsType;
});
export const defaultCodecGenerators = new Map([
    genDef(NullCodec, () => "null"),
    genDef(EnumCodec, (codec) => {
        return `(${codec.values.map((val) => JSON.stringify(val)).join(" | ")})`;
    }),
    genDef(ScalarCodec, (codec, ctx) => {
        if (codec.tsModule) {
            ctx.imports.add(codec.tsModule, codec.tsType);
        }
        return codec.tsType;
    }),
    genDef(ObjectCodec, (codec, ctx) => {
        const subCodecs = codec.getSubcodecs();
        const originalFields = codec.getFields();
        const fieldsWithCodecs = originalFields.map((field, i) => ({
            name: field.name,
            cardinality: util.parseCardinality(field.cardinality),
            codec: subCodecs[i],
        }));
        const sortedFieldsWithCodecs = fieldsWithCodecs.sort((a, b) => {
            const aPriority = getSortPriority(a);
            const bPriority = getSortPriority(b);
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            return a.name.localeCompare(b.name);
        });
        return generateTsObject(sortedFieldsWithCodecs, ctx);
    }),
    genDef(NamedTupleCodec, (codec, ctx) => {
        const subCodecs = codec.getSubcodecs();
        const fields = codec.getNames().map((name, i) => ({
            name,
            codec: subCodecs[i],
            cardinality: Cardinality.One,
        }));
        return generateTsObject(fields, ctx);
    }),
    genDef(TupleCodec, (codec, ctx) => {
        const subCodecs = codec
            .getSubcodecs()
            .map((subCodec) => ctx.walk(subCodec));
        const tuple = `[${subCodecs.join(", ")}]`;
        return ctx.readonly ? `(readonly ${tuple})` : tuple;
    }),
    genDef(ArrayCodec, (codec, ctx) => ctx.applyCardinality(ctx.walk(codec.getSubcodecs()[0]), Cardinality.Many)),
    genDef(RangeCodec, (codec, ctx) => {
        const subCodec = codec.getSubcodecs()[0];
        if (!(subCodec instanceof ScalarCodec)) {
            throw Error("expected range subtype to be scalar type");
        }
        ctx.imports.add(codec.tsModule, codec.tsType);
        return `${codec.tsType}<${ctx.walk(subCodec)}>`;
    }),
    genDef(MultiRangeCodec, (codec, ctx) => {
        const subCodec = codec.getSubcodecs()[0];
        if (!(subCodec instanceof ScalarCodec)) {
            throw Error("expected multirange subtype to be scalar type");
        }
        ctx.imports.add(codec.tsModule, codec.tsType);
        return `${codec.tsType}<${ctx.walk(subCodec)}>`;
    }),
]);
export const generateTsObject = (fields, ctx) => {
    const properties = fields.map((field) => generateTsObjectField(field, ctx));
    return `{\n${properties.join("\n")}\n${ctx.indent}}`;
};
export const generateTsObjectField = (field, ctx) => {
    const codec = unwrapSetCodec(field);
    const name = JSON.stringify(field.name);
    const value = ctx.applyCardinality(ctx.walk(codec, { ...ctx, indent: ctx.indent + "  " }), field.cardinality);
    const optional = ctx.optionalNulls && field.cardinality === Cardinality.AtMostOne;
    const questionMark = optional ? "?" : "";
    const isReadonly = ctx.readonly ? "readonly " : "";
    return `${ctx.indent}  ${isReadonly}${name}${questionMark}: ${value};`;
};
function unwrapSetCodec(field) {
    if (!(field.codec instanceof SetCodec)) {
        return field.codec;
    }
    if (field.cardinality === Cardinality.Many ||
        field.cardinality === Cardinality.AtLeastOne) {
        return field.codec.getSubcodecs()[0];
    }
    throw new Error("Sub-codec is SetCodec, but upper cardinality is one");
}
export const defaultApplyCardinalityToTsType = (ctx) => (type, cardinality) => {
    switch (cardinality) {
        case Cardinality.Many:
            return `${ctx.readonly ? "Readonly" : ""}Array<${type}>`;
        case Cardinality.One:
            return type;
        case Cardinality.AtMostOne:
            return `${type} | null`;
        case Cardinality.AtLeastOne: {
            const tuple = `[(${type}), ...(${type})[]]`;
            return ctx.readonly ? `(readonly ${tuple})` : tuple;
        }
    }
    throw new Error(`Unexpected cardinality: ${cardinality}`);
};
export class ImportMap extends Map {
    add(module, specifier) {
        if (!this.has(module)) {
            this.set(module, new Set());
        }
        this.get(module).add(specifier);
        return this;
    }
    merge(map) {
        const out = new ImportMap();
        for (const [mod, specifiers] of [...this, ...map]) {
            for (const specifier of specifiers) {
                out.add(mod, specifier);
            }
        }
        return out;
    }
}
