export function structurallyHostileRecords(
  fields: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  const accessor = { ...fields }
  const firstKey = Object.keys(fields)[0]
  Object.defineProperty(accessor, firstKey, {
    enumerable: true,
    configurable: true,
    get: () => fields[firstKey],
  })
  const symbol = { ...fields }
  Object.defineProperty(symbol, Symbol('hidden'), {
    value: true,
    enumerable: true,
  })
  const nonEnumerable = { ...fields }
  Object.defineProperty(nonEnumerable, firstKey, {
    value: fields[firstKey],
    enumerable: false,
  })
  return [
    accessor,
    symbol,
    nonEnumerable,
    Object.assign([], fields),
    Object.assign(Object.create({ inherited: true }), fields),
    new Proxy({ ...fields }, {}),
  ]
}
