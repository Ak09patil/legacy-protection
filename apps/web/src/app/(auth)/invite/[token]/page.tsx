import { Heading, Panel } from "@/components/app/ui";
import { openInvite } from "@/server/auth";
import { SignUpForm } from "../../PasskeyForms";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await openInvite(token);
  if (!inv) {
    return (
      <div className="space-y-4 text-center">
        <Heading className="text-[clamp(2rem,7vw,2.4rem)]">This invitation has expired</Heading>
        <p className="text-[17px] text-ink-soft">Invitations last 7 days and work once. Ask for a new one.</p>
      </div>
    );
  }
  const owner = inv.owner_name.split(" ")[0];
  const asContact = inv.role === "TRUSTED_CONTACT";
  return (
    <div className="space-y-6">
      <div>
        <Heading className="text-[clamp(2rem,7vw,2.6rem)]">
          {owner} has asked you to {asContact ? "be their trusted contact" : "be their executor"}
        </Heading>
        <p className="mt-3 text-[17px] text-ink-soft">
          {asContact
            ? `You’ll hear about anything unusual, and you can tell us if something has happened to ${owner}. You can never move or receive their money.`
            : `If ${owner}’s plan ever starts, you’ll get a clear record of what happened to their PayPal account. Until then, you can’t see anything.`}
        </p>
      </div>
      <Panel>
        <SignUpForm inviteToken={token} defaultName={inv.name} defaultEmail={inv.email} />
      </Panel>
    </div>
  );
}
