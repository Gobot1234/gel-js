import { StrictMap } from "../strictMap";
import { replaceNumberTypes } from "./functions";
import { util } from "../util";
const _operators = async (cxn) => {
    const operatorsJson = await cxn.queryJSON(`
    with module schema
    select Operator {
      id,
      name,
      annotations: {
        name,
        @value
      } filter .name in {'std::identifier', 'std::description'},
      operator_kind,
      return_type: {id, name},
      return_typemod,
      params: {
        name,
        type: {id, name},
        kind,
        typemod,
      } order by @index,
    } filter not .internal and not .abstract
  `);
    const operators = new StrictMap();
    const seenOpDefHashes = new Set();
    for (const op of JSON.parse(operatorsJson)) {
        const identifier = op.annotations.find((anno) => anno.name === "std::identifier")?.["@value"];
        if (!identifier) {
            continue;
        }
        const { mod } = util.splitName(op.name);
        const name = `${mod}::${identifier}`;
        const opDef = {
            ...op,
            name,
            kind: op.operator_kind,
            originalName: op.name,
            description: op.annotations.find((anno) => anno.name === "std::description")?.["@value"],
            annotations: undefined,
        };
        replaceNumberTypes(opDef);
        const hash = hashOpDef(opDef);
        if (!seenOpDefHashes.has(hash)) {
            if (!operators.has(name)) {
                operators.set(name, [opDef]);
            }
            else {
                operators.get(name).push(opDef);
            }
            seenOpDefHashes.add(hash);
        }
    }
    return operators;
};
function hashOpDef(def) {
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
        operator_kind: def.operator_kind,
    });
}
export { _operators as operators };
