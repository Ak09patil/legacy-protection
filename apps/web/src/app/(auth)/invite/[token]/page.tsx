import { Heading, Panel } from "@/components/app/ui";
import { getI18n } from "@/i18n/server";
import { openInvite } from "@/server/auth";
import { SignUpForm } from "../../PasskeyForms";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  const inv = await openInvite(token);
  if (!inv) {
    return (
      <div className="space-y-4 text-center">
        <Heading className="text-[clamp(2rem,7vw,2.4rem)]">{t.auth.inviteExpiredTitle}</Heading>
        <p className="text-[18px] text-ink-soft">{t.auth.inviteExpiredLead}</p>
      </div>
    );
  }
  const owner = inv.owner_name.split(" ")[0] ?? inv.owner_name;
  const asContact = inv.role === "TRUSTED_CONTACT";
  return (
    <div className="space-y-6">
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">{asContact ? t.auth.inviteContactTitle(owner) : t.auth.inviteExecutorTitle(owner)}</Heading>
        <p className="mt-3 text-[18px] leading-[1.6] text-ink-soft">{asContact ? t.auth.inviteContactLead(owner) : t.auth.inviteExecutorLead(owner)}</p>
      </div>
      <Panel>
        <SignUpForm inviteToken={token} defaultName={inv.name} defaultEmail={inv.email} />
      </Panel>
    </div>
  );
}
