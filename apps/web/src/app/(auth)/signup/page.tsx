import Link from "next/link";
import { redirect } from "next/navigation";
import { Heading, Panel } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import { currentUser } from "@/server/auth";
import { SignUpForm } from "../PasskeyForms";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await currentUser()) redirect("/home");
  const { t } = await getI18n();
  return (
    <div className="space-y-6">
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{t.auth.signUpTitle}</Heading>
        <p className="mt-2 text-[18px] text-ink-soft">{t.auth.signUpLead}</p>
      </div>
      <Panel>
        <SignUpForm />
      </Panel>
      <p className="text-center text-[18px]">
        {t.auth.alreadySetUp}{" "}
        <Link href="/signin" className="inline-block min-h-[48px] content-center font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px]">
          {t.auth.signIn}
        </Link>
      </p>
    </div>
  );
}
