import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

import { getI18n } from "@/lib/i18n/server";

export default async function DriverNotFound() {
  const { path } = await getI18n();

  return (
    <div className="mx-auto max-w-xl rounded-md border border-line bg-surface px-5 py-8 text-center sm:px-8">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-soft text-muted" aria-hidden>
        <FileQuestion size={22} />
      </span>
      <h1 className="mt-4 text-[1.25rem] leading-snug font-semibold text-ink">That job is not yours to see</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
        <bdi>It may have been reassigned, or the link is wrong.</bdi>
      </p>
      <Link
        href={path("/driver")}
        className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-brand px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden />
        Back to today
      </Link>
    </div>
  );
}
