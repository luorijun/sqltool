import type { ColumnType, MySqlTypeRef } from "../ports"

const names: Record<number, [string, ColumnType["typeFamily"]]> = {
  0: ["decimal", "decimal"],
  1: ["tinyint", "number"],
  2: ["smallint", "number"],
  3: ["int", "number"],
  4: ["float", "number"],
  5: ["double", "number"],
  6: ["null", "unknown"],
  7: ["timestamp", "datetime"],
  8: ["bigint", "number"],
  9: ["mediumint", "number"],
  10: ["date", "date"],
  11: ["time", "time"],
  12: ["datetime", "datetime"],
  13: ["year", "number"],
  14: ["date", "date"],
  15: ["varchar", "string"],
  16: ["bit", "binary"],
  242: ["vector", "unknown"],
  245: ["json", "json"],
  246: ["decimal", "decimal"],
  247: ["enum", "string"],
  248: ["set", "string"],
  249: ["tinyblob", "binary"],
  250: ["mediumblob", "binary"],
  251: ["longblob", "binary"],
  252: ["blob", "binary"],
  253: ["varchar", "string"],
  254: ["char", "string"],
  255: ["geometry", "unknown"],
}

const extended = new Map<string, ColumnType["typeFamily"]>([
  ["uuid", "uuid"],
  ["inet4", "string"],
  ["inet6", "string"],
  ["json", "json"],
])

function isString(code: number | undefined): boolean {
  return code === 15 || code === 253 || code === 254
}

export function needsMySqlCharset(ref: MySqlTypeRef): boolean {
  if (ref.charset === undefined || ref.charset === 63) return false
  if (ref.extendedType || ref.extendedFormat === "json") return false
  if (isString(ref.code)) return (ref.flags & (256 | 2048)) === 0
  return ref.code === 252
}

export function resolveMySqlType(
  ref: MySqlTypeRef,
  width?: number,
): ColumnType {
  if (ref.extendedFormat === "json")
    return { dbType: "json", typeFamily: "json" }
  if (ref.extendedType) {
    return {
      dbType: ref.extendedType,
      typeFamily: extended.get(ref.extendedType) ?? "unknown",
    }
  }
  const entry = ref.code === undefined ? undefined : names[ref.code]
  if (!entry) return { typeFamily: "unknown" }
  let [name, family] = entry
  const binary = ref.charset === 63
  const unsigned = (ref.flags & 32) !== 0
  const length = ref.length
  const scale = ref.decimals
  const sized = (size: number | undefined) => {
    if (size !== undefined && Number.isInteger(size) && size >= 0)
      name += `(${size})`
  }
  if (isString(ref.code)) {
    if (ref.flags & 256) name = "enum"
    else if (ref.flags & 2048) name = "set"
    else {
      if (binary) name = ref.code === 254 ? "binary" : "varbinary"
      family = binary ? "binary" : "string"
      sized(
        binary
          ? length
          : width && length !== undefined
            ? length / width
            : undefined,
      )
    }
  } else if (ref.code !== undefined && ref.code >= 249 && ref.code <= 252) {
    family = binary ? "binary" : "string"
    if (ref.code === 252 && length !== undefined) {
      // Result character conversion changes the protocol byte limit; LONG is capped at uint32.
      const size = binary ? length : width ? length / width : undefined
      if (length === 0xffffffff) name = "longblob"
      else if (size === 255) name = "tinyblob"
      else if (size === 65535) name = "blob"
      else if (size === 16777215) name = "mediumblob"
    }
    if (!binary) name = name.replace("blob", "text")
  } else if (family === "decimal") {
    // Protocol display length includes the sign and (when present) decimal point.
    const precision =
      length === undefined
        ? undefined
        : length - (unsigned ? 0 : 1) - (scale > 0 ? 1 : 0)
    if (
      precision !== undefined &&
      Number.isInteger(precision) &&
      precision > 0 &&
      Number.isInteger(scale) &&
      scale >= 0 &&
      scale <= precision &&
      precision <= 65
    )
      name += `(${precision},${scale})`
  } else if (family === "datetime" || family === "time") {
    if (Number.isInteger(scale) && scale > 0 && scale <= 6) sized(scale)
  } else if (ref.code === 16) sized(length)
  if (
    unsigned &&
    (family === "decimal" || (family === "number" && ref.code !== 13))
  )
    name += " unsigned"
  return { dbType: name, typeFamily: family }
}
