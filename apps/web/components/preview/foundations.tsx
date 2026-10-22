"use client";

import { InformationCircleIcon, Message01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@repo/design-system/components/alert";
import { Avatar, AvatarFallback } from "@repo/design-system/components/avatar";
import { Badge } from "@repo/design-system/components/badge";
import { Button } from "@repo/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import { Checkbox } from "@repo/design-system/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/design-system/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/design-system/components/empty";
import { Field, FieldDescription, FieldLabel } from "@repo/design-system/components/field";
import { Input } from "@repo/design-system/components/input";
import { Kbd } from "@repo/design-system/components/kbd";
import { Label } from "@repo/design-system/components/label";
import { Skeleton } from "@repo/design-system/components/skeleton";
import { Spinner } from "@repo/design-system/components/spinner";
import { Switch } from "@repo/design-system/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/design-system/components/tabs";
import { Textarea } from "@repo/design-system/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system/components/tooltip";
import { toast } from "sonner";
import { Section, Specimen } from "./section";

export function FoundationsPreview() {
  return (
    <Section title="Foundations" description="Base components themed by preset bjbigatl2.">
      <div className="grid gap-4 md:grid-cols-2">
        <Specimen label="Button">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="icon" aria-label="Add">
            <HugeiconsIcon icon={PlusSignIcon} />
          </Button>
          <Button disabled>
            <Spinner data-icon="inline-start" />
            Loading
          </Button>
        </Specimen>

        <Specimen label="Badge · Avatar · Kbd">
          <Badge>New</Badge>
          <Badge variant="secondary">Beta</Badge>
          <Badge variant="outline">Draft</Badge>
          <Badge variant="destructive">Error</Badge>
          <Avatar>
            <AvatarFallback>CW</AvatarFallback>
          </Avatar>
          <Kbd>⌘K</Kbd>
        </Specimen>

        <Specimen label="Field · Input · Textarea">
          <div className="flex w-full flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="preview-email">Email</FieldLabel>
              <Input id="preview-email" type="email" placeholder="you@example.com" />
              <FieldDescription>We never share your email.</FieldDescription>
            </Field>
            <Textarea placeholder="Write a note…" />
          </div>
        </Specimen>

        <Specimen label="Switch · Checkbox · Skeleton">
          <div className="flex w-full flex-col gap-4">
            <div className="flex items-center gap-2">
              <Switch id="preview-switch" defaultChecked />
              <Label htmlFor="preview-switch">Stream responses</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="preview-checkbox" />
              <Label htmlFor="preview-checkbox">Remember context</Label>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          </div>
        </Specimen>

        <Specimen label="Tabs">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm text-muted-foreground">
              A summary of your workspace.
            </TabsContent>
            <TabsContent value="activity" className="text-sm text-muted-foreground">
              Recent conversations and runs.
            </TabsContent>
          </Tabs>
        </Specimen>

        <Specimen label="Dialog · Tooltip · Toast">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Start a new chat?</DialogTitle>
                <DialogDescription>Your current conversation will be saved.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button>New chat</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            onClick={() => toast("Saved", { description: "Your changes are stored." })}
          >
            Show toast
          </Button>
        </Specimen>

        <Card>
          <CardHeader>
            <CardTitle>Card</CardTitle>
            <CardDescription>Group related content and actions.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">Cards hold a title, content, and a footer.</CardContent>
          <CardFooter>
            <Button size="sm">Action</Button>
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-4">
          <Alert>
            <HugeiconsIcon icon={InformationCircleIcon} />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Alerts call out important information.</AlertDescription>
          </Alert>
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Message01Icon} />
              </EmptyMedia>
              <EmptyTitle>No conversations</EmptyTitle>
              <EmptyDescription>Start a chat to see it here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    </Section>
  );
}
