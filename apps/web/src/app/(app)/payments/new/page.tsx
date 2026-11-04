import Link from "next/link";
import { Heading } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import { requireRole } from "@/server/plans";
import { NewPaymentForm } from "./NewPaymentForm";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage() {
  await requireRole("OWNER");
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block min-h-[48px] content-center text-[17px] font-semibold text-green">
        ← {t.common.backHome}
      </Link>
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.payment.newTitle}</Heading>
        <p className="mt-2 text-[18px] text-ink-soft">{t.payment.newLead}</p>
      </div>
      <NewPaymentForm />
    </div>
  );
}
