import {
  type Ref,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { DbDriver } from "@/contracts/database"
import {
  type CursorPosition,
  createSqlEditorController,
  type EditorSelectionStats,
  getSelectionStats,
  type SqlEditorController,
} from "./controller"
import type { EditorState as EditorViewState } from "./types"

export type { CursorPosition, EditorSelectionStats }

export interface SqlEditorHandle {
  focus: () => void
  openSearch: () => void
}

interface SqlEditorProps {
  ref?: Ref<SqlEditorHandle>

  value: string
  driver?: DbDriver
  readOnly?: boolean
  autoFocus?: boolean
  editorState: EditorViewState
  onChange?: (value: string) => void
  onEditorStateChange: (editorState: EditorViewState) => void
  onRun?: () => void
  onFormat?: () => void
}

function SqlEditor({
  ref,
  value,
  driver,
  readOnly = false,
  autoFocus = false,
  editorState,
  onChange,
  onEditorStateChange,
  onRun,
  onFormat,
}: SqlEditorProps) {
  const controllerRef = useRef<SqlEditorController | null>(null)
  const initialValueRef = useRef(value)
  const initialDriverRef = useRef(driver)
  const initialEditorStateRef = useRef(editorState)
  const initialReadOnlyRef = useRef(readOnly)
  const initialAutoFocusRef = useRef(autoFocus)
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  initialValueRef.current = value
  initialDriverRef.current = driver
  initialEditorStateRef.current = editorState
  initialReadOnlyRef.current = readOnly
  initialAutoFocusRef.current = autoFocus

  const handleChange = useEffectEvent((nextValue: string) => {
    onChange?.(nextValue)
  })

  const handleEditorStateChange = useEffectEvent(
    (nextEditorState: EditorViewState) => {
      onEditorStateChange(nextEditorState)
    },
  )

  const handleRun = useEffectEvent(() => {
    if (!readOnly) onRun?.()
  })

  const handleFormat = useEffectEvent(() => {
    if (!readOnly) onFormat?.()
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
      readOnly: initialReadOnlyRef.current,
      editorState: initialEditorStateRef.current,
      onChange: handleChange,
      onEditorStateChange: handleEditorStateChange,
      onRun: handleRun,
      onFormat: handleFormat,
    })

    controllerRef.current = controller
    if (initialAutoFocusRef.current) controller.focus()

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
    controllerRef.current?.setReadOnly(readOnly)
  }, [readOnly])

  useEffect(() => {
    controllerRef.current?.setValue(value)
  }, [value])

  useEffect(() => {
    controllerRef.current?.syncViewState(editorState)
  }, [editorState])

  return <div ref={setHostRef} className="size-full min-w-0 min-h-0" />
}

export { getSelectionStats, SqlEditor }
