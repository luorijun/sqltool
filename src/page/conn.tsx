import { Form } from "@base-ui/react"
import { buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"

export default function NewConn() {
  return (
    <Dialog>
      <DialogTrigger className={buttonVariants()}>new conn</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Connection</DialogTitle>
          <DialogDescription>
            Create a new connection to a database.
          </DialogDescription>
        </DialogHeader>

        <Form>
          <FieldSet>
            <FieldLegend>db config</FieldLegend>
            <Field>
              <FieldLabel>host</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>port</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>username</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>password</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>schema</FieldLabel>
              <Input />
            </Field>
          </FieldSet>
          <Separator className="my-6" />
          <FieldSet>
            <FieldLegend>ssh config</FieldLegend>
            <Field>
              <FieldLabel>host</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>port</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>username</FieldLabel>
              <Input />
            </Field>
            <Field>
              <FieldLabel>password</FieldLabel>
              <Input />
            </Field>
          </FieldSet>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
