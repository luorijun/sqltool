import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { cn } from "tailwind-variants"
import { Button } from "../../src/renderer/components/ui/button"
import { Tabs, TabsList } from "../../src/renderer/components/ui/tabs"

describe("UI class overrides", () => {
  test("conditional classes merge with the last override taking precedence", () => {
    expect(
      cn("px-2 text-sm", [false, "px-4"], {
        "text-lg": true,
        hidden: false,
      }),
    ).toBe("px-4 text-lg")
  })

  test("button overrides preserve its variant and receive Base UI state", () => {
    const html = renderToStaticMarkup(
      createElement(
        Button,
        {
          disabled: true,
          variant: "secondary",
          size: "sm",
          className: (state) => (state.disabled ? "h-12 px-8" : "h-10"),
        },
        "Run",
      ),
    )
    const classes = html.match(/class="([^"]*)"/)?.[1].split(" ") ?? []
    expect(classes).toContain("bg-secondary")
    expect(classes).toContain("h-12")
    expect(classes).toContain("px-8")
    expect(classes).not.toContain("h-8")
    expect(classes).not.toContain("px-3")
  })

  test("tabs list overrides receive Base UI state and merge with its variant", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "query" },
        createElement(TabsList, {
          variant: "line",
          className: (state) =>
            state.orientation === "horizontal" ? "gap-4 p-2" : "gap-8",
        }),
      ),
    )
    const classes = [...html.matchAll(/class="([^"]*)"/g)]
      .map((match) => match[1].split(" "))
      .find((classes) => classes.includes("group/tabs-list"))
    expect(classes).toContain("bg-transparent")
    expect(classes).toContain("gap-4")
    expect(classes).toContain("p-2")
    expect(classes).not.toContain("gap-1")
    expect(classes).not.toContain("p-0.75")
  })
})
