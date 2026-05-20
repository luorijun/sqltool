import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { DbDriver } from "@/lib/conn"
import type { TabEditorState } from "@/lib/tabs"
import {
  type CursorPosition,
  createSqlEditorController,
  type EditorSelectionStats,
  getSelectionStats,
  type SqlEditorController,
} from "./editor-controller"

export type { CursorPosition, EditorSelectionStats }

export interface SqlEditorHandle {
  focus: () => void
  openSearch: () => void
}

interface SqlEditorProps {
  value: string
  driver?: DbDriver
  editorState: TabEditorState
  onChange: (value: string) => void
  onEditorStateChange: (editorState: TabEditorState) => void
  onRun: () => void
  onFormat: () => void
}

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    {
      value,
      driver,
      editorState,
      onChange,
      onEditorStateChange,
      onRun,
      onFormat,
    },
    ref,
  ) {
    const controllerRef = useRef<SqlEditorController | null>(null)
    const initialValueRef = useRef(value)
    const initialDriverRef = useRef(driver)
    const initialEditorStateRef = useRef(editorState)
    const [host, setHost] = useState<HTMLDivElement | null>(null)

    initialValueRef.current = value
    initialDriverRef.current = driver
    initialEditorStateRef.current = editorState

    const handleChange = useEffectEvent((nextValue: string) => {
      onChange(nextValue)
    })

    const handleEditorStateChange = useEffectEvent(
      (nextEditorState: TabEditorState) => {
        onEditorStateChange(nextEditorState)
      },
    )

    const handleRun = useEffectEvent(() => {
      onRun()
    })

    const handleFormat = useEffectEvent(() => {
      onFormat()
    })

    const setHostRef = useCallback((node: HTMLDivElement | null) => {
      setHost(node)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          controllerRef.current?.focus()
        },
        openSearch() {
          controllerRef.current?.openSearch()
        },
      }),
      [],
    )

    useLayoutEffect(() => {
      if (!host) {
        return
      }

      const controller = createSqlEditorController({
        host,
        value: initialValueRef.current,
        driver: initialDriverRef.current,
        editorState: initialEditorStateRef.current,
        onChange: handleChange,
        onEditorStateChange: handleEditorStateChange,
        onRun: handleRun,
        onFormat: handleFormat,
      })

      controllerRef.current = controller

      return () => {
        if (controllerRef.current === controller) {
          controllerRef.current = null
        }

        controller.destroy()
      }
    }, [host])

    useEffect(() => {
      controllerRef.current?.setDriver(driver)
    }, [driver])

    useEffect(() => {
      controllerRef.current?.setValue(value)
    }, [value])

    useEffect(() => {
      controllerRef.current?.syncViewState(editorState)
    }, [editorState])

    return <div ref={setHostRef} className="size-full min-w-0 min-h-0" />
  },
)

export { SqlEditor, getSelectionStats }
