import { StrictMap } from "../strictMap";
import { typeMapping } from "./types";
export const functions = async (cxn) => {
    const functionsJson = await cxn.queryJSON(`
    with module schema
    select Function {
      id,
      name,
      annotations: {
        name,
        @value
      } filter .name = 'std::description',
      return_type: {id, name},
      return_typemod,
      params: {
        name,
        type: {id, name},
        kind,
        typemod,
        hasDefault := exists .default,
      } order by @index,
      preserves_optionality,
    } filter .internal = false
  `);
    const functionMap = new StrictMap();
    const seenFuncDefHashes = new Set();
    for (const func of JSON.parse(functionsJson)) {
        const { name } = func;
        const funcDef = {
            ...func,
            description: func.annotations[0]?.["@value"],
        };
        replaceNumberTypes(funcDef);
        const hash = hashFuncDef(funcDef);
        if (!seenFuncDefHashes.has(hash)) {
            if (!functionMap.has(name)) {
                functionMap.set(name, [funcDef]);
            }
            else {
                functionMap.get(name).push(funcDef);
            }
            seenFuncDefHashes.add(hash);
        }
    }
    return functionMap;
};
export function replaceNumberTypes(def) {
    if (typeMapping.has(def.return_type.id)) {
        const type = typeMapping.get(def.return_type.id);
        def.return_type = {
            id: type.id,
            name: type.name,
        };
    }
    for (const param of def.params) {
        if (typeMapping.has(param.type.id)) {
            const type = typeMapping.get(param.type.id);
            param.type = {
                id: type.id,
                name: type.name,
            };
        }
    }
}
function hashFuncDef(def) {
    return JSON.stringify({
        name: def.name,
        return_type: def.return_type.id,
        return_typemod: def.return_typemod,
        params: def.params
            .map((param) => JSON.stringify({
            kind: param.kind,
            type: param.type.id,
            typemod: param.typemod,
            hasDefault: !!param.hasDefault,
        }))
            .sort(),
        preserves_optionality: def.preserves_optionality,
    });
}
