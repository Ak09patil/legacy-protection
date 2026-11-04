import { readFileSync } from "node:fs";
import path from "node:path";
import { Heading, Panel, money } from "@/components/app/ui";
import { auditTrail, story, verifyAudit } from "@/server/world";
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

export default function OpsPage() {
  const m = loadMetrics();
  const s = story();
  const chain = verifyAudit();
  const trail = [...auditTrail()].reverse();
  const tz = s.timeZone;
  const time = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(ms);

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
            {s.payments.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-baseline justify-between gap-2 text-[15px]">
                  <span>
                    {p.payeeName} <span className="text-ink-soft">{money(p.amountMinor)}</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${LEVEL[p.decision.level].cls}`}>{LEVEL[p.decision.level].text}</span>
                </div>
                {p.decision.reasons.length > 0 && (
                  <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
                    {p.decision.reasons.map((r) => (
                      <li key={r.code + r.source}>
                        <span className="font-mono">{r.code}</span> · {r.source === "MODEL" ? "model" : "rule"}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 font-mono text-[12px] text-ink-soft">{p.decision.policyVersion}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel aria-labelledby="audit-h">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="audit-h" className="text-[17px] font-semibold">
            Sealed record
          </h2>
          <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${chain.ok ? "bg-sage text-green" : "bg-[#FCEFD9] text-amber-ink"}`}>
            {chain.ok ? `Chain intact · ${chain.length} entries` : `Chain broken at ${chain.brokenAt}`}
          </span>
        </div>
        <p className="mt-1 text-[15px] text-ink-soft">Append-only. Each entry carries the seal of the one before, so nothing can be quietly edited or removed.</p>
        <div className="mt-4 max-h-[26rem] overflow-auto">
          <table className="w-full min-w-[40rem] text-left text-[14px]">
            <thead className="sticky top-0 bg-white/95 text-[12px] text-ink-soft">
              <tr>
                <th className="py-2 pr-3 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">When</th>
                <th className="py-2 pr-3 font-semibold">Who</th>
                <th className="py-2 pr-3 font-semibold">What happened</th>
                <th className="py-2 font-semibold">Seal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8">
              {trail.map((e) => (
                <tr key={e.seq} className="align-top">
                  <td className="py-2 pr-3 tabular-nums text-ink-soft">{e.seq}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-soft">{time(e.at)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{e.actor}</td>
                  <td className="py-2 pr-3">{e.text}</td>
                  <td className="py-2 font-mono text-[12px] text-ink-soft">{e.hash.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
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
