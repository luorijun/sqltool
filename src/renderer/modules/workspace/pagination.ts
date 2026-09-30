export function getPagination(
  offset: number,
  limit: number,
  total: number | null,
) {
  const remainder = offset % limit
  return {
    page: Math.ceil(offset / limit) + 1,
    totalPages:
      total === null
        ? null
        : Math.max(
            1,
            remainder === 0
              ? Math.ceil(total / limit)
              : 1 + Math.ceil(Math.max(0, total - remainder) / limit),
          ),
  }
}

export function pageOffset(page: number, offset: number, limit: number) {
  if (page === 1) return 0
  const remainder = offset % limit
  return remainder === 0 ? (page - 1) * limit : remainder + (page - 2) * limit
}
