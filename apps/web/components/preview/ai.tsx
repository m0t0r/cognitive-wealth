"use client";

import * as React from "react";
import {
  ArrowDown01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  Brain02Icon,
  File01Icon,
  GlobeIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@repo/design-system/components/attachment";
import { Bubble, BubbleContent } from "@repo/design-system/components/bubble";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@repo/design-system/components/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@repo/design-system/components/input-group";
import { Marker, MarkerContent } from "@repo/design-system/components/marker";
import { Message, MessageContent, MessageFooter } from "@repo/design-system/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/design-system/components/message-scroller";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@repo/design-system/components/questionnaire";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@repo/design-system/components/trace";
import { toast } from "sonner";
import { Section, Specimen } from "./section";

const models = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

const sources = [
  { title: "Vanguard: Asset allocation basics", url: "https://investor.vanguard.com" },
  { title: "Investopedia: Rebalancing", url: "https://www.investopedia.com" },
];

const snippet = `const target = { stocks: 0.6, bonds: 0.4 };
const drift = current.stocks - target.stocks;
if (Math.abs(drift) > 0.05) rebalance(portfolio, target);`;

const toolOutput = `{
  "stocks": 0.67,
  "bonds": 0.33,
  "lastRebalanced": "2026-03-14"
}`;

const questionnaireItems = [
  {
    name: "horizon",
    required: true,
    choices: [{ value: "short" }, { value: "medium" }, { value: "long" }],
  },
  {
    name: "risk",
    required: true,
    choices: [{ value: "low" }, { value: "balanced" }, { value: "high" }],
  },
] as const;

export function AiPreview() {
  return (
    <Section
      title="AI"
      description="Chat primitives: MessageScroller, Message, Bubble, Trace, Attachment, Marker, CodeBlock, Questionnaire, and a prompt input."
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <ChatPreview />
        <div className="flex flex-col gap-4">
          <QuestionnairePreview />
          <Specimen label="Attachment states">
            <div className="flex w-full flex-col gap-2">
              <Attachment state="uploading" size="sm">
                <AttachmentMedia variant="icon">
                  <HugeiconsIcon icon={File01Icon} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>statement-q3.pdf</AttachmentTitle>
                  <AttachmentDescription>Uploading…</AttachmentDescription>
                </AttachmentContent>
              </Attachment>
              <Attachment state="error" size="sm">
                <AttachmentMedia variant="icon">
                  <HugeiconsIcon icon={File01Icon} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>holdings.csv</AttachmentTitle>
                  <AttachmentDescription>Upload failed</AttachmentDescription>
                </AttachmentContent>
              </Attachment>
            </div>
          </Specimen>
        </div>
      </div>
    </Section>
  );
}

function ChatPreview() {
  return (
    <div className="flex h-[40rem] min-w-0 flex-col overflow-hidden rounded-xl border">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-6 p-4">
              <MessageScrollerItem messageId="marker">
                <Marker variant="separator">
                  <MarkerContent>Today</MarkerContent>
                </Marker>
              </MessageScrollerItem>
              <MessageScrollerItem messageId="user-1" scrollAnchor>
                <Message align="end">
                  <MessageContent>
                    <Attachment state="done" size="sm">
                      <AttachmentMedia variant="icon">
                        <HugeiconsIcon icon={File01Icon} />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>portfolio.pdf</AttachmentTitle>
                        <AttachmentDescription>PDF · 1.2 MB</AttachmentDescription>
                      </AttachmentContent>
                    </Attachment>
                    <Bubble align="end">
                      <BubbleContent>Should I rebalance my portfolio this quarter?</BubbleContent>
                    </Bubble>
                    <MessageFooter>9:41</MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
              <MessageScrollerItem messageId="assistant-1">
                <Message align="start">
                  <MessageContent>
                    <AssistantActivity />
                    <p className="text-sm leading-relaxed">
                      Your allocation has drifted to 67% stocks against a 60% target. That is past a
                      5% band, so a rebalance is reasonable. A simple drift check looks like this:
                    </p>
                    <CodeBlock size="sm">
                      <CodeBlockHeader>
                        <CodeBlockTitle>rebalance.ts</CodeBlockTitle>
                        <CodeBlockActions>
                          <CodeBlockCopyButton value={snippet} />
                        </CodeBlockActions>
                      </CodeBlockHeader>
                      <CodeBlockContent>{snippet}</CodeBlockContent>
                    </CodeBlock>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="border-t p-3">
        <PromptInput />
      </div>
    </div>
  );
}

function AssistantActivity() {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <HugeiconsIcon icon={Brain02Icon} />
            </TraceIcon>
            <TraceTitle>Thought</TraceTitle>
            <TraceDescription>4s</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="text-sm text-muted-foreground">
          The user attached a portfolio statement. Read current weights, compare to the target, then
          check common rebalancing guidance.
        </TraceCollapsibleContent>
      </TraceCollapsible>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <HugeiconsIcon icon={Search01Icon} />
            </TraceIcon>
            <TraceTitle>Ran get_allocation</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm">
            <CodeBlockContent wrap>{toolOutput}</CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <HugeiconsIcon icon={GlobeIcon} />
            </TraceIcon>
            <TraceTitle>Used {sources.length} sources</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${source.title} (opens in a new tab)`}
              >
                <TraceLine>
                  <TraceIcon>
                    <HugeiconsIcon icon={GlobeIcon} />
                  </TraceIcon>
                  <TraceTitle>
                    {source.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </TraceTitle>
                  <TraceIcon>
                    <HugeiconsIcon icon={ArrowUpRight01Icon} />
                  </TraceIcon>
                </TraceLine>
              </a>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      <TraceLine status="running">
        <TraceIcon>
          <HugeiconsIcon icon={Search01Icon} />
        </TraceIcon>
        <TraceTitle>Running tax_lot_lookup</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

function PromptInput() {
  const [model, setModel] = React.useState(models[0]!.id);
  const [prompt, setPrompt] = React.useState("");
  const selected = models.find((m) => m.id === model);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        toast("Message sent", { description: `${selected?.label}: ${prompt}` });
        setPrompt("");
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-label="Message"
          placeholder="Ask about your finances…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="icon-xs" variant="ghost" aria-label="Attach file">
            <HugeiconsIcon icon={Attachment01Icon} />
          </InputGroupButton>
          <DropdownMenu>
            <DropdownMenuTrigger render={<InputGroupButton size="xs" variant="ghost" />}>
              {selected?.label}
              <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                  {models.map((m) => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>
                      {m.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <InputGroupButton
            type="submit"
            size="icon-xs"
            variant="default"
            className="ml-auto"
            aria-label="Send"
            disabled={!prompt.trim()}
          >
            <HugeiconsIcon icon={ArrowUp02Icon} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function QuestionnairePreview() {
  return (
    <div className="rounded-xl border p-4">
      <Questionnaire
        defaultItem="horizon"
        items={questionnaireItems}
        shortcuts="numbers"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const answer = (name: string) => {
            const value = data.get(name);
            return typeof value === "string" ? value : "none";
          };
          toast("Profile saved", {
            description: `Horizon: ${answer("horizon")} · Risk: ${answer("risk")}`,
          });
        }}
      >
        <QuestionnaireProgress />
        <QuestionnaireItem name="horizon" required>
          <QuestionnaireTitle>What is your investment horizon?</QuestionnaireTitle>
          <QuestionnaireDescription>Helps the assistant tailor advice.</QuestionnaireDescription>
          <QuestionnaireChoices>
            <QuestionnaireChoice value="short">
              Under 3 years
              <QuestionnaireChoiceDescription>
                Saving for something soon
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
            <QuestionnaireChoice value="medium">3 to 10 years</QuestionnaireChoice>
            <QuestionnaireChoice value="long">Over 10 years</QuestionnaireChoice>
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireItem name="risk" required>
          <QuestionnaireTitle>How do you feel about risk?</QuestionnaireTitle>
          <QuestionnaireChoices>
            <QuestionnaireChoice value="low">Keep it steady</QuestionnaireChoice>
            <QuestionnaireChoice value="balanced">Balanced</QuestionnaireChoice>
            <QuestionnaireChoice value="high">Growth first</QuestionnaireChoice>
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireNext>Next</QuestionnaireNext>
          <QuestionnaireSubmit>Save</QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  );
}
