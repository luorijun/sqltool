import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "@/renderer/components/ui/button"
import { Tabs, TabsList } from "@/renderer/components/ui/tabs"

describe("UI class overrides", () => {
  test("button custom classes receive disabled state", () => {
    const html = renderToStaticMarkup(
      createElement(
        Button,
        {
          disabled: true,
          variant: "secondary",
          size: "sm",
          className: (state) =>
            state.disabled ? "disabled-control" : "enabled-control",
        },
        "Run",
      ),
    )
    expect(html).toContain("disabled-control")
    expect(html).not.toContain("enabled-control")
  })

  test("tabs list custom classes receive orientation state", () => {
    const html = renderToStaticMarkup(
      createElement(
        Tabs,
        { value: "query" },
        createElement(TabsList, {
          variant: "line",
          className: (state) =>
            state.orientation === "horizontal"
              ? "horizontal-tabs"
              : "vertical-tabs",
        }),
      ),
    )
    expect(html).toContain("horizontal-tabs")
    expect(html).not.toContain("vertical-tabs")
  })
})
