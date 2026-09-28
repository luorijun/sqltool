import type { ReactNode } from "react"
import {
  type Control,
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"
import { Field, FieldDescription, FieldError, FieldLabel } from "./field"

export function FormField<
  F extends FieldValues,
  N extends FieldPath<F>,
>(props: {
  control: Control<F>
  name: N
  label: ReactNode
  description?: ReactNode
  children: ControllerProps<F, N>["render"]
}) {
  return (
    <Controller
      control={props.control}
      name={props.name}
      render={(fProps) => (
        <FormInput
          name={props.name}
          label={props.label}
          description={props.description}
          errors={[fProps.fieldState.error]}
        >
          {props.children(fProps)}
        </FormInput>
      )}
    />
  )
}

export function FormInput<
  F extends FieldValues,
  N extends FieldPath<F>,
>(props: {
  name: N
  label: ReactNode
  description?: ReactNode
  errors?: { message?: string }[]
  children: ReactNode
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      {props.description && (
        <FieldDescription>{props.description}</FieldDescription>
      )}
      {props.children}
      <FieldError errors={props.errors} />
    </Field>
  )
}
