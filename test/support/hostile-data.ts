export function structurallyHostileRecords<Fields extends object>(
  fields: Readonly<Fields>,
): readonly unknown[] {
  const ownFields: Record<PropertyKey, unknown> = Object.fromEntries(
    Reflect.ownKeys(fields).flatMap((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(fields, key)
      return descriptor?.enumerable && 'value' in descriptor
        ? [[key, descriptor.value]]
        : []
    }),
  )
  const accessor = { ...ownFields }
  const firstKey = Object.keys(ownFields)[0]
  Object.defineProperty(accessor, firstKey, {
    enumerable: true,
    configurable: true,
    get: () => ownFields[firstKey],
  })
  const symbol = { ...ownFields }
  Object.defineProperty(symbol, Symbol('hidden'), {
    value: true,
    enumerable: true,
  })
  const nonEnumerable = { ...ownFields }
  Object.defineProperty(nonEnumerable, firstKey, {
    value: ownFields[firstKey],
    enumerable: false,
  })
  return [
    accessor,
    symbol,
    nonEnumerable,
    Object.assign([], ownFields),
    Object.assign(Object.create({ inherited: true }), ownFields),
    new Proxy({ ...ownFields }, {}),
  ]
}
