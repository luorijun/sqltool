import type { ComponentProps, ReactNode } from "react"
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
  group?: boolean
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
          invalid={fProps.fieldState.invalid}
          touched={fProps.fieldState.isTouched}
          dirty={fProps.fieldState.isDirty}
          group={props.group}
        >
          {props.children(fProps)}
        </FormInput>
      )}
    />
  )
}

export function FormInput(props: {
  name: string
  label: ReactNode
  description?: ReactNode
  errors?: ComponentProps<typeof FieldError>["errors"]
  invalid?: boolean
  touched?: boolean
  dirty?: boolean
  group?: boolean
  children: ReactNode
}) {
  return (
    <Field
      name={props.name}
      invalid={props.invalid ?? props.errors?.some(Boolean)}
      touched={props.touched}
      dirty={props.dirty}
    >
      <FieldLabel
        nativeLabel={!props.group}
        render={props.group ? <span /> : undefined}
      >
        {props.label}
      </FieldLabel>
      {props.description && (
        <FieldDescription>{props.description}</FieldDescription>
      )}
      {props.children}
      <FieldError errors={props.errors} />
    </Field>
  )
}
