import type { SortingState } from "@tanstack/react-table"
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { ResultTable } from "../../src/renderer/components/result-grid/table"
import { Paging } from "../../src/renderer/pages/workbench/workspace/tab-page/table-area/paging"

declare global {
  interface Window {
    prepareDrag: () => Promise<{
      x: number
      y: number
      targetX: number
      targetY: number
    }>
    finishDrag: () => Promise<void>
    runTests: () => Promise<string>
    IS_REACT_ACT_ENVIRONMENT: boolean
  }
}
window.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById("root") as HTMLElement)
function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (el) =>
      el.getAttribute("aria-label") === label ||
      el.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
const click = (label: string) =>
  act(async () => {
    button(label).click()
  })
const commits: SortingState[] = []
function Grid() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [order, setOrder] = useState<string[]>([])
  return (
    <ResultTable
      readOnly={false}
      sorting={sorting}
      sortOrder={order}
      onSortingChange={(next, order) => {
        setOrder(order)
        commits.push(next)
        setSorting(next)
      }}
      tableState={{
        dataAt: 1,
        data: [{ a: 1, b: 2, c: 3 }],
        columns: ["a", "b", "c"].map((id) => ({
          id,
          name: id,
          typeFamily: "number",
        })),
        visibility: {},
        sizing: {},
        pinning: { start: [], end: [] },
        selection: null,
      }}
      copyOptions={{ format: "tsv", headers: false }}
      onCopyOptionsChange={() => {}}
      onSelectionChange={() => {}}
      onLayoutChange={() => {}}
      onReset={() => {}}
      onExport={async () => {}}
      onError={(message) => {
        throw new Error(message)
      }}
    />
  )
}

async function sortingEvents() {
  await act(async () => {
    root.render(<Grid />)
  })
  await click("排序")
  for (const name of ["a", "b", "c"]) {
    const handle = button(`调整 ${name} 的排序优先级`)
    check(
      !handle.disabled && handle.draggable,
      "All fields must be draggable before enabling sorting",
    )
  }
  await click("a 升序")
  await click("b 升序")
  await click("c 降序")
  const handle = button("调整 a 的排序优先级")
  check(handle.draggable && !handle.disabled, "Active handle must be draggable")
  const target = button("c 降序").closest("li") as HTMLElement
  const rect = target.getBoundingClientRect()
  const transfer = new DataTransfer()
  // Deliberately batch hover and drop before React commits the preview state.
  await act(async () => {
    handle.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    )
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientY: rect.top,
      }),
    )
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientY: rect.bottom - 1,
      }),
    )
    handle.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }),
    )
  })
  check(commits.length === 0, "Dragging must not submit SQL")
  const rows = [...document.querySelectorAll('ul[aria-label="排序字段"] li')]
  check(
    rows
      .map((row) =>
        row.querySelector("button[draggable]")?.getAttribute("aria-label"),
      )
      .join() === "调整 b 的排序优先级,调整 c 的排序优先级,调整 a 的排序优先级",
    "Drop should use release coordinates, independently of preview state",
  )
  await click("应用")
  check(
    commits.length === 1 &&
      commits[0].map((order) => order.id).join() === "b,c,a",
    "Closing submits reordered draft exactly once",
  )
  await click("排序")
  await click("b 降序")
  await act(async () => {
    button("b 降序").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
  })
  check(commits.length === 1, "Escape must discard the draft")
  await click("排序")
  await click("应用")
  check(commits.length === 1, "An unchanged draft must not submit")
  await click("排序")
  await click("b 升序")
  await click("c 降序")
  await click("a 升序")
  const orderNames = () =>
    [
      ...document.querySelectorAll(
        'ul[aria-label="排序字段"] li button[draggable]',
      ),
    ]
      .map((el) => el.getAttribute("aria-label"))
      .join()
  check(
    orderNames() ===
      "调整 b 的排序优先级,调整 c 的排序优先级,调整 a 的排序优先级",
    "Disabling all directions preserves list order",
  )
  await click("应用")
  await click("排序")
  check(
    orderNames() ===
      "调整 b 的排序优先级,调整 c 的排序优先级,调整 a 的排序优先级",
    "Reopening preserves inactive field positions",
  )
  await click("清除排序")
  check(
    orderNames() ===
      "调整 a 的排序优先级,调整 b 的排序优先级,调整 c 的排序优先级",
    "Only clear restores original field order",
  )
  await click("应用")
}

async function pagingEvents() {
  const pages: number[] = []
  await act(async () => {
    root.render(
      <Paging
        offset={100}
        limit={50}
        page={3}
        totalPages={10}
        total={500}
        hasNext
        busy={false}
        onPage={(page) => {
          pages.push(page)
        }}
        onSize={() => {}}
        onRange={() => {}}
      />,
    )
  })
  const input = document.querySelector(
    'input[aria-label="跳转页码"]',
  ) as HTMLInputElement
  check(input, "Missing page input")
  const type = async (value: string) =>
    act(async () => {
      input.focus()
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  await type("7")
  await act(async () => {
    input.blur()
  })
  check(
    pages.join() === "7" && input.value === "3",
    `Blur result: pages=${pages}, input=${input.value}`,
  )
  await type("8")
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    )
  })
  check(pages.join() === "7,8", "Enter must use the same blur submission")
  await type("9")
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
  })
  check(
    pages.join() === "7,8" && input.value === "3",
    "Escape cancels the draft",
  )
  for (const invalid of ["", "0", "-1", "1.5", "3"]) {
    await type(invalid)
    await act(async () => {
      input.blur()
    })
  }
  check(pages.join() === "7,8", "Invalid and unchanged values must not submit")
  await type("100")
  await act(async () => {
    input.blur()
  })
  check(
    pages.join() === "7,8,10",
    "Excess page number must clamp to the last page",
  )
  await type("6")
  await act(async () => {
    const next = button("下一页")
    next.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
    )
    next.focus()
    next.click()
  })
  check(
    pages.join() === "7,8,10,4",
    "Navigation must win over a pending jump without double submission",
  )
  await type("6")
  await act(async () => {
    button("上一页").focus()
  })
  check(
    pages.join() === "7,8,10,4,6",
    "Keyboard focus changes remain ordinary blur submissions",
  )
  check(
    button("首页").textContent === "" && button("下一页").textContent === "",
    "Navigation uses icon buttons",
  )
  check(
    ![...document.querySelectorAll("button")].some(
      (el) => el.textContent === "跳转",
    ),
    "No explicit jump button",
  )
  await click("末页")
  check(pages.at(-1) === 10, "Last-page button targets the known last page")
  for (const totalPages of [null, 3]) {
    await act(async () => {
      root.render(
        <Paging
          offset={100}
          limit={50}
          page={3}
          totalPages={totalPages}
          total={null}
          hasNext={false}
          busy={false}
          onPage={(page) => {
            pages.push(page)
          }}
          onSize={() => {}}
          onRange={() => {}}
        />,
      )
    })
    check(
      button("末页").disabled,
      "Last-page navigation is disabled for unknown total or current last page",
    )
  }
}

window.prepareDrag = async () => {
  await act(async () => {
    root.render(<Grid key="native" />)
  })
  await click("排序")
  const source = button("调整 a 的排序优先级").getBoundingClientRect()
  const row = button("c 降序").closest("li")
  if (!row) throw new Error("Missing drop target")
  const target = row.getBoundingClientRect()
  window.IS_REACT_ACT_ENVIRONMENT = false
  return {
    x: Math.round(source.left + source.width / 2),
    y: Math.round(source.top + source.height / 2),
    targetX: Math.round(source.left + source.width / 2),
    targetY: Math.floor(target.bottom - 1),
  }
}
window.finishDrag = async () => {
  window.IS_REACT_ACT_ENVIRONMENT = true
  check(commits.length === 0, "Native dragging must not submit SQL")
  await click("c 降序")
  await click("a 升序")
  await click("应用")
  check(
    commits.length === 1 &&
      commits[0].map((order) => order.id).join() === "c,a",
    "Dragging inactive fields must determine subsequent active priorities",
  )
  commits.length = 0
}

window.runTests = async () => {
  await sortingEvents()
  await pagingEvents()
  await act(async () => root.unmount())
  return "PASS: sort drag/drop, draft commit/cancel, blur/Enter/Escape paging, validation and navigation precedence"
}
