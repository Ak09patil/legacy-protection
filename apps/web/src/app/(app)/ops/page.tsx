import { readFileSync } from "node:fs";
import path from "node:path";
import { Heading, Panel, money } from "@/components/app/ui";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { RingMap } from "./RingMap";

export const dynamic = "force-dynamic";

interface Metrics {
  version: string;
  roc_auc: number;
  scam_flagged_rate: number;
  scam_held_rate: number;
  normal_false_hold_rate: number;
  normal_false_flag_rate: number;
  test_payments: number;
  test_scam_payments: number;
  per_scam_type: Record<string, { flagged: number; n: number }>;
}

/** Reads the metrics the training run wrote (services/risk/reports/metrics.json). Never typed in by hand. */
function loadMetrics(): Metrics | null {
  for (const p of [path.join(process.cwd(), "../../services/risk/reports/metrics.json"), path.join(process.cwd(), "services/risk/reports/metrics.json")]) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Metrics;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

const TYPE_LABEL: Record<string, string> = {
  tech_support: "Tech support",
  investment: "Investment",
  government_impostor: "Government impostor",
  family_emergency: "Family emergency",
  romance: "Romance",
};

const LEVEL = {
  PASS: { text: "Sent", cls: "bg-sage text-green" },
  REVIEW: { text: "Asked owner", cls: "bg-[#FCEFD9] text-amber-ink" },
  HOLD: { text: "Held", cls: "bg-[#FCEFD9] text-amber-ink" },
} as const;

/** PayPal staff only. Allowed emails come from OPS_EMAILS; anyone else gets a 404, not a hint. */
export default async function OpsPage() {
  const user = await currentUser();
  const allowed = (process.env.OPS_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!user || !allowed.includes(user.email.toLowerCase())) notFound();
  const m = loadMetrics();
  const decisions = await db().query<{ payee_name: string; amount_minor: string; level: "PASS" | "REVIEW" | "HOLD"; reasons: Array<{ code: string; source: string }>; policy_version: string; model_status: string; decided_at: Date }>(
    `SELECT p.payee_name, p.amount_minor, d.level, d.reasons, d.policy_version, d.model_status, d.decided_at
       FROM payment_decisions d JOIN payments p ON p.id = d.payment_id ORDER BY d.decided_at DESC LIMIT 20`,
  );
  const types = m
    ? Object.entries(m.per_scam_type)
        .filter(([k]) => !k.endsWith("_grooming"))
        .sort((a, b) => b[1].flagged - a[1].flagged)
    : [];

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <p className="text-[15px] font-semibold text-ink-soft">Operations · for PayPal’s trust and safety team</p>
        <Heading className="mt-1 text-[clamp(2rem,5vw,2.8rem)]">How the protection is performing</Heading>
        <p className="mt-2 max-w-[44rem] text-[17px] text-ink-soft">
          Every number below is read from the latest training run. The data is synthetic, calibrated to FBI IC3 and FTC loss patterns, until real data is loaded.
        </p>
      </div>

      {m ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Scam payments caught" value={pct(m.scam_flagged_rate)} note={`held or checked with the owner, of ${m.test_scam_payments.toLocaleString()} scams`} />
            <Stat label="Scam payments held" value={pct(m.scam_held_rate)} note="stopped before money moved" />
            <Stat label="Normal payments held" value={pct(m.normal_false_hold_rate, 2)} note={`target under 0.50%, of ${m.test_payments.toLocaleString()} payments`} />
            <Stat label="Ranking quality (AUC)" value={m.roc_auc.toFixed(3)} note={`model ${m.version}`} />
          </div>

          <Panel aria-labelledby="types-h">
            <h2 id="types-h" className="text-[17px] font-semibold">
              Caught, by kind of scam
            </h2>
            <p className="mt-1 text-[15px] text-ink-soft">
              Share of each scam type held or checked with the owner. Romance scams are hardest: they look like ordinary payments to someone the owner trusts.
            </p>
            <ul className="mt-5 space-y-3.5" aria-label="Share caught by scam type">
              {types.map(([k, v]) => (
                <li key={k} className="group grid grid-cols-[minmax(8rem,11rem)_1fr_3.5rem] items-center gap-3 text-[15px]" title={`${TYPE_LABEL[k] ?? k}: ${pct(v.flagged)} of ${v.n} test scams`}>
                  <span>{TYPE_LABEL[k] ?? k}</span>
                  <span className="relative h-3 rounded-full bg-ink/6">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-green transition-opacity group-hover:opacity-80" style={{ width: `${v.flagged * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-ink-soft">{pct(v.flagged, 0)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[14px] text-ink-soft">
              Small “getting to know you” payments before a scam are deliberately not held. They’re reported separately, not hidden in these numbers.
            </p>
          </Panel>
        </>
      ) : (
        <Panel>
          <p className="text-[17px]">The risk model’s metrics file wasn’t found. Run the training step in services/risk to produce it.</p>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Panel aria-labelledby="ring-h">
          <h2 id="ring-h" className="text-[17px] font-semibold">
            Scam ring sentinel
          </h2>
          <p className="mt-1 text-[15px] text-ink-soft">
            One new account receiving first-time payments from many unrelated people, then moving the money straight out. Example pattern, synthetic data.
          </p>
          <RingMap />
          <ul className="mt-2 space-y-1.5 text-[15px]">
            <li>• This payee recently received first-time payments from 10 or more unrelated accounts.</li>
            <li>• This payee’s account is less than a week old.</li>
            <li>• Most of the money this payee received was moved out again within a day.</li>
          </ul>
          <p className="mt-3 text-[14px] text-ink-soft">
            A network signal alone can only ask the owner to check. It never holds a payment to a registered carer on its own.
          </p>
        </Panel>

        <Panel aria-labelledby="dec-h">
          <h2 id="dec-h" className="text-[17px] font-semibold">
            Recent decisions
          </h2>
          <ul className="mt-3 divide-y divide-ink/8">
            {decisions.rows.length === 0 && <li className="py-3 text-[15px] text-ink-soft">No decisions yet.</li>}
            {decisions.rows.map((p, i) => (
              <li key={i} className="py-3">
                <div className="flex items-baseline justify-between gap-2 text-[15px]">
                  <span>
                    {p.payee_name} <span className="text-ink-soft">{money(Number(p.amount_minor))}</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${LEVEL[p.level].cls}`}>{LEVEL[p.level].text}</span>
                </div>
                {p.reasons.length > 0 && (
                  <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
                    {p.reasons.map((r) => (
                      <li key={r.code + r.source}>
                        <span className="font-mono">{r.code}</span> · {r.source === "MODEL" ? "model" : "rule"}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 font-mono text-[12px] text-ink-soft">
                  {p.policy_version} · model {p.model_status.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Panel className="!p-5">
      <p className="text-[14px] font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-[2.2rem] leading-none tabular-nums [font-variation-settings:'SOFT'_100]">{value}</p>
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">{note}</p>
    </Panel>
  );
}
