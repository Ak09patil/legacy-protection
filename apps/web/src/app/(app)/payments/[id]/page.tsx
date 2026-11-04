import Link from "next/link";
import { notFound } from "next/navigation";
import { Heading, Panel, buttonStyles, money } from "@/components/app/ui";
import { payment, world } from "@/server/world";
import { paymentAction } from "../../actions";

export const dynamic = "force-dynamic";

function Action({ id, action, label, variant }: { id: string; action: string; label: string; variant: keyof typeof buttonStyles }) {
  return (
    <form action={paymentAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={buttonStyles[variant]}>
        {label}
      </button>
    </form>
  );
}

const fmt = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(ms);

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = payment(id);
  if (!p) notFound();
  const contact = world().plan.trustedContact.name;
  const open = p.status === "PAUSED" || p.status === "WAITING_FOR_CONTACT";
  const reasons = p.decision.reasons.filter((r, i, all) => all.findIndex((x) => x.text === r.text) === i).slice(0, 3);

  return (
    <div className="space-y-5 pt-2">
      <Link href="/home" className="inline-block text-[16px] font-semibold text-green">
        Back home
      </Link>

      {p.decision.level === "PASS" ? (
        <div>
          <Heading className="text-[clamp(1.9rem,6vw,2.4rem)]">This payment looked normal</Heading>
          <p className="mt-2 text-[17px] text-ink-soft">We checked it and sent it straight away.</p>
        </div>
      ) : (
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#FCEFD9] px-4 py-1.5 text-[14px] font-semibold text-amber-ink">
            <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
            {open ? "Waiting for you" : p.status === "RELEASE_SCHEDULED" ? "Sending soon" : "Decided"}
          </span>
          <Heading className="mt-4 text-[clamp(1.9rem,6vw,2.4rem)]">
            {p.status === "STOPPED_BY_OWNER"
              ? "This payment wasn’t sent"
              : p.status === "RELEASE_SCHEDULED"
                ? "This payment will go in 24 hours"
                : "We paused a payment to check it with you"}
          </Heading>
        </div>
      )}

      <Panel aria-label="Payment details">
        <p className="text-[15px] text-ink-soft">{open ? "You were about to send" : "Payment"}</p>
        <p className="mt-1 text-[2.4rem] font-semibold leading-none tracking-[-0.02em]">{money(p.amountMinor)}</p>
        <p className="mt-2 text-[17px]">
          to {p.payeeName}
          {p.payeeIsNew && <span className="text-ink-soft">, someone you haven’t paid before</span>}
        </p>
        {p.note && (
          <p className="mt-4 rounded-2xl bg-mist px-4 py-3 text-[16px] italic text-ink-soft">Their note: “{p.note}”</p>
        )}
      </Panel>

      {reasons.length > 0 && (
        <Panel aria-labelledby="why-title">
          <Heading as="h2" className="text-[1.5rem]">
            <span id="why-title">Why we paused it</span>
          </Heading>
          <ul className="mt-3 space-y-3">
            {reasons.map((r) => (
              <li key={r.code} className="flex gap-3 text-[17px] leading-[1.5]">
                <span aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 rounded-full bg-[radial-gradient(circle,#FFF6E6_30%,#F6DDB0_100%)]" />
                {r.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {open && (
        <div className="space-y-3">
          <Action id={p.id} action="stop" label="Don’t send it" variant="primary" />
          {p.status === "PAUSED" && <Action id={p.id} action="ask-contact" label={`Talk it over with ${contact}`} variant="soft" />}
          {p.status === "WAITING_FOR_CONTACT" && (
            <p className="text-center text-[16px] text-ink-soft">We’ve let {contact} know. She’ll be in touch.</p>
          )}
          <form action={paymentAction} className="pt-2 text-center">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="action" value="send-anyway" />
            <button type="submit" className={buttonStyles.quiet}>
              Send anyway
            </button>
            <p className="mx-auto mt-2 max-w-[24rem] text-[14px] leading-[1.5] text-ink-soft">
              If you choose this, we’ll wait 24 hours first and let {contact} know. People who pressure you to pay
              fast are often scammers.
            </p>
          </form>
        </div>
      )}

      {p.status === "RELEASE_SCHEDULED" && p.releaseAt && (
        <div className="space-y-3">
          <p className="text-center text-[17px]">It goes on {fmt(p.releaseAt)}. You can still stop it until then.</p>
          <Action id={p.id} action="cancel-release" label="Stop it after all" variant="primary" />
        </div>
      )}

      <Panel aria-labelledby="hist-title" className="bg-white/50">
        <h2 id="hist-title" className="text-[16px] font-semibold">What’s happened so far</h2>
        <ol className="mt-2 space-y-2 text-[15px] text-ink-soft">
          {p.history.map((h, i) => (
            <li key={i}>
              <span className="text-ink">{fmt(h.at)}</span>: {h.text}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
