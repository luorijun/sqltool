import { expect, test } from "bun:test"
import {
  getPagination,
  pageOffset,
} from "../../src/renderer/modules/workspace/pagination"

test("custom ranges retain their boundaries until the first page resets alignment", () => {
  const total = 250,
    limit = 50
  let offset = 125
  expect(getPagination(offset, limit, total)).toEqual({
    page: 4,
    totalPages: 6,
  })
  offset = pageOffset(3, offset, limit)
  expect(offset).toBe(75)
  offset = pageOffset(2, offset, limit)
  expect(offset).toBe(25)
  offset = pageOffset(1, offset, limit)
  expect(offset).toBe(0)
  expect(getPagination(offset, limit, total)).toEqual({
    page: 1,
    totalPages: 5,
  })
  expect(pageOffset(2, offset, limit)).toBe(50)
})

test("page counts include partial leading and trailing pages without inventing an unknown total", () => {
  expect(getPagination(125, 50, null)).toEqual({ page: 4, totalPages: null })
  expect(getPagination(0, 50, 0)).toEqual({ page: 1, totalPages: 1 })
  expect(getPagination(25, 50, 25).totalPages).toBe(1)
  expect(getPagination(25, 50, 26).totalPages).toBe(2)
  expect(getPagination(75, 50, 125).totalPages).toBe(3)
  expect(getPagination(75, 50, 126).totalPages).toBe(4)
  expect(pageOffset(4, 75, 50)).toBe(125)
})

test("non-first pages round-trip through offset on every possible remainder", () => {
  for (let remainder = 0; remainder < 50; remainder++) {
    for (let page = 2; page <= 8; page++) {
      const offset = pageOffset(page, remainder, 50)
      expect(getPagination(offset, 50, null).page).toBe(page)
      expect(offset % 50).toBe(remainder)
    }
  }
})
