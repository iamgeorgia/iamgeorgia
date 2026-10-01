"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight, Info, ShieldAlert, type LucideIcon } from "lucide-react";

import { AdminDefinitionList } from "@/components/admin/AdminPage";
import { Cell, DataTable, Row } from "@/components/admin/DataTable";
import { useLocalePath } from "@/lib/i18n/provider";
import type { CalloutTone, HelpBlock, HelpLinkTargets } from "@/lib/admin/help/types";
import { cn } from "@/lib/utils";
import { HelpInline } from "./HelpInline";

/**
 * One renderer per block type. Everything an article can say passes through
 * here, which is what keeps eighty articles looking like one document: the
 * prose measure, the callout tones, the table, the path chips are decided
 * once.
 *
 * Every callout ships an icon and a word — Note, Careful, Irreversible — as
 * the status badges do, so the tone survives without colour vision.
 */

const CALLOUTS: Record<CalloutTone, { word: string; icon: LucideIcon; className: string }> = {
  info: { word: "Note", icon: Info, className: "border-info/30 bg-info/8 text-ink" },
  warning: {
    word: "Careful",
    icon: AlertTriangle,
    className: "border-warning/40 bg-warning/12 text-ink",
  },
  danger: {
    word: "Irreversible",
    icon: ShieldAlert,
    className: "border-error/40 bg-error/8 text-ink",
  },
};

const ICON_TONE: Record<CalloutTone, string> = {
  info: "text-info",
  warning: "text-warning-text",
  danger: "text-error-text",
};

export function Callout({
  tone,
  title,
  text,
}: {
  tone: CalloutTone;
  title?: string;
  text: string;
}) {
  const { word, icon: Icon, className } = CALLOUTS[tone];

  return (
    <div role="note" className={cn("flex gap-3 rounded-sm border px-4 py-3.5", className)}>
      <Icon size={17} className={cn("mt-0.5 shrink-0", ICON_TONE[tone])} aria-hidden />
      <div className="min-w-0 text-[0.875rem] leading-relaxed">
        <p className="font-semibold">
          {word}
          {title && <span className="font-semibold"> — {title}</span>}
        </p>
        <p className="mt-1 text-body">
          <HelpInline text={text} />
        </p>
      </div>
    </div>
  );
}

/** How to reach the screen: `Sidebar → Inventory → Hotels → Images`. */
export function WhereChip({ path }: { path: string[] }) {
  return (
    <p
      aria-label="Where to find it"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8125rem] text-muted"
    >
      {path.map((label, index) => (
        <span key={`${label}-${index}`} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-xs bg-surface-soft px-1.5 py-0.5",
              index === path.length - 1 ? "font-medium text-ink" : "text-body",
            )}
          >
            {label}
          </span>
          {index < path.length - 1 && (
            <ChevronRight size={13} className="text-subtle rtl:-scale-x-100" aria-hidden />
          )}
        </span>
      ))}
    </p>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-2 ps-6 text-[0.9375rem] leading-relaxed text-body marker:font-semibold marker:text-brand-text">
      {items.map((item, index) => (
        <li key={index} className="ps-1">
          <HelpInline text={item} />
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 ps-6 text-[0.9375rem] leading-relaxed text-body marker:text-subtle">
      {items.map((item, index) => (
        <li key={index} className="ps-1">
          <HelpInline text={item} />
        </li>
      ))}
    </ul>
  );
}

function HelpTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="rounded-sm border border-line bg-surface">
      <DataTable
        columns={columns.map((label) => ({ label }))}
        caption={columns.join(", ")}
        className="[&_table]:md:min-w-0"
      >
        {rows.map((row, rowIndex) => (
          <Row key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <Cell key={cellIndex} className="align-top text-[0.875rem] leading-relaxed">
                <HelpInline text={cell} />
              </Cell>
            ))}
          </Row>
        ))}
      </DataTable>
    </div>
  );
}

function Definitions({ items }: { items: { term: string; description: string }[] }) {
  return (
    <AdminDefinitionList
      className="rounded-sm border border-line bg-surface px-5 py-4 [&_dd]:text-start [&_dd]:font-normal [&_dd]:text-body [&_dd]:sm:max-w-[65%] [&_dt]:font-semibold [&_dt]:text-ink"
      items={items.map((item) => ({
        label: item.term,
        value: <HelpInline text={item.description} />,
      }))}
    />
  );
}

export function HelpLinks({
  items,
  targets,
}: {
  items: { label: string; href?: string; articleId?: string }[];
  targets: HelpLinkTargets;
}) {
  const path = useLocalePath();

  const resolved = items
    .map((item) => {
      if (item.articleId) {
        const target = targets[item.articleId];
        return target ? { label: item.label, href: target.href } : null;
      }
      return item.href ? { label: item.label, href: item.href } : null;
    })
    .filter((item): item is { label: string; href: string } => item !== null);

  if (resolved.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {resolved.map((item) => (
        <li key={`${item.href}-${item.label}`}>
          <Link
            href={path(item.href)}
            className="inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-brand-text underline-offset-4 hover:underline"
          >
            {item.label}
            <ChevronRight size={14} className="rtl:-scale-x-100" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HelpBlockView({
  block,
  targets,
  headingId,
}: {
  block: HelpBlock;
  targets: HelpLinkTargets;
  /** Turns a heading's id into the DOM id to use, so two renders never collide. */
  headingId: (id: string) => string;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="text-[0.9375rem] leading-relaxed text-body">
          <HelpInline text={block.text} />
        </p>
      );
    case "heading":
      return (
        <h2
          id={headingId(block.id)}
          className="scroll-mt-24 border-b border-line pt-2 pb-2 text-[1.0625rem] font-semibold text-ink"
        >
          {block.text}
        </h2>
      );
    case "steps":
      return <Steps items={block.items} />;
    case "list":
      return <Bullets items={block.items} />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} text={block.text} />;
    case "table":
      return <HelpTable columns={block.columns} rows={block.rows} />;
    case "definitions":
      return <Definitions items={block.items} />;
    case "where":
      return <WhereChip path={block.path} />;
    case "links":
      return <HelpLinks items={block.items} targets={targets} />;
    case "figure":
      // Reserved for a screenshot pipeline; nothing to show yet.
      return null;
  }
}
