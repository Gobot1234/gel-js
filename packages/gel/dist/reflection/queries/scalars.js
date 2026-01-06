import { StrictMap } from "../strictMap";
const _scalars = async (cxn) => {
    const scalarArray = await cxn.queryJSON(`with module schema
select InheritingObject {
  id,
  name,
  is_abstract,
  bases: { id, name },
  ancestors: { id, name },
  children := .<bases[IS Type] { id, name },
  descendants := .<ancestors[IS Type] { id, name }
}
FILTER
  InheritingObject IS ScalarType OR
  InheritingObject IS ObjectType;
`);
    const scalars = new StrictMap();
    for (const type of JSON.parse(scalarArray)) {
        scalars.set(type.id, type);
    }
    return scalars;
};
export { _scalars as scalars };
