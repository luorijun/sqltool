import { expect, test } from "bun:test"
import {
  activeSorting,
  createSortDraft,
  moveSort,
  sameSorting,
  toggleSort,
} from "../../src/renderer/components/result-grid/sorting"

test("all columns can be ordered before sorting and direction toggles never move them", () => {
  const initial = createSortDraft(["a", "b", "c"], [], [])
  let draft = moveSort(initial, "c", 0)
  expect(draft.map((item) => item.id)).toEqual(["c", "a", "b"])
  expect(activeSorting(draft)).toEqual([])
  draft = toggleSort(draft, "b", true)
  draft = toggleSort(draft, "c", false)
  expect(activeSorting(draft)).toEqual([
    { id: "c", desc: false },
    { id: "b", desc: true },
  ])
  draft = toggleSort(draft, "c", false)
  expect(draft.map((item) => item.id)).toEqual(["c", "a", "b"])
  draft = toggleSort(draft, "c", true)
  expect(activeSorting(draft)).toEqual([
    { id: "c", desc: true },
    { id: "b", desc: true },
  ])
  expect(initial.every((item) => item.desc === null)).toBe(true)
})

test("saved order survives reopening and schema changes, while clear restores source order", () => {
  const sorting = [{ id: "b", desc: true }]
  const draft = createSortDraft(["a", "b", "c"], sorting, ["c", "a", "b"])
  expect(draft).toEqual([
    { id: "c", desc: null },
    { id: "a", desc: null },
    { id: "b", desc: true },
  ])
  expect(
    createSortDraft(
      ["b", "c", "d"],
      sorting,
      draft.map((item) => item.id),
    ).map((item) => item.id),
  ).toEqual(["c", "b", "d"])
  const cleared = createSortDraft(["a", "b", "c"], [], [])
  expect(cleared.map((item) => item.id)).toEqual(["a", "b", "c"])
  expect(activeSorting(cleared)).toEqual([])
})

test("only changes to active priorities require SQL", () => {
  const draft = createSortDraft(
    ["a", "b", "c"],
    [
      { id: "a", desc: false },
      { id: "c", desc: true },
    ],
    [],
  )
  expect(
    sameSorting(activeSorting(moveSort(draft, "b", 2)), activeSorting(draft)),
  ).toBe(true)
  expect(
    sameSorting(activeSorting(moveSort(draft, "c", 0)), activeSorting(draft)),
  ).toBe(false)
  expect(moveSort(draft, "a", -1)).toBe(draft)
  expect(moveSort(draft, "c", 3)).toBe(draft)
})
