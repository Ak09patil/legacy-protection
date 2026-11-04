import Link from "next/link";
import { Heading } from "@/components/app/ui";
import { requireRole } from "@/server/plans";
import { NewPaymentForm } from "./NewPaymentForm";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage() {
  await requireRole("OWNER");
  return (
    <div className="mx-auto max-w-[34rem] space-y-5 pt-2">
      <Link href="/home" className="inline-block text-[16px] font-semibold text-green">
        Back home
      </Link>
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">Send money</Heading>
        <p className="mt-2 text-[17px] text-ink-soft">We check every payment before any money leaves. Most go straight through.</p>
      </div>
      <NewPaymentForm />
    </div>
  );
}
