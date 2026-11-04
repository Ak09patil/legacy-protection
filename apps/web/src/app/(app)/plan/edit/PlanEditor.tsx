"use client";

import { useEffect, useId, useState, useTransition } from "react";
import type { PlanDocument } from "@lp/policy";
import { Heading, Panel, buttonStyles } from "@/components/app/ui";
import { confirmPlanAction, draftFromWordsAction, previewPlanAction, suggestCarersAction } from "../../actions";

type Carer = PlanDocument["obligations"][number];

const field =
  "mt-1.5 w-full rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[17px] text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";
const label = "block text-[16px] font-semibold";

function Field({ label: text, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {hint && <p className="text-[14px] text-ink-soft">{hint}</p>}
      {children(id)}
    </div>
  );
}

const dollars = (minor: number) => String(minor / 100);
const toMinor = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100) || 0;

export function PlanEditor({ initial, detectTimeZone = false }: { initial: PlanDocument; detectTimeZone?: boolean }) {
  const [plan, setPlan] = useState<PlanDocument>(initial);
  useEffect(() => {
    if (!detectTimeZone) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setPlan((p) => ({ ...p, checkin: { ...p.checkin, timeZone: tz } }));
  }, [detectTimeZone]);
  const [words, setWords] = useState("");
  const [summary, setSummary] = useState<string[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  type Suggestion = { payeeName: string; payeeEmail: string; amountPerPaymentMinor: number; cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY"; why: string; payments: number };
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const suggest = () =>
    start(async () => {
      setSuggestNote(null);
      const r = await suggestCarersAction();
      if (r.ok) {
        const known = new Set(plan.obligations.map((o) => o.payeeEmail));
        const fresh = r.carers.filter((c) => !known.has(c.payeeEmail));
        setSuggestions(fresh);
        setSuggestNote(
          fresh.length
            ? `Found in ${r.source}. Check each one before adding.`
            : r.dropped.length
              ? "We didn’t find anyone paid regularly enough to suggest. You can still add someone yourself."
              : "We didn’t find anyone who looks like they work in your home.",
        );
      } else {
        setSuggestions(null);
        setSuggestNote(
          {
            AI_OFF: "Suggestions from your payment history aren’t switched on here yet. Add people yourself below.",
            NO_HISTORY: "There’s no payment history to look at yet. Add people yourself below.",
            PROVIDER_UNAVAILABLE: "We couldn’t look at your payments just now. Try again in a moment, or add people yourself.",
            INVALID_OUTPUT: "We couldn’t make sense of your payments safely. Add people yourself below.",
            TOO_MANY_STEPS: "That took too long. Try again, or add people yourself.",
          }[r.reason],
        );
      }
    });
  const addSuggestion = (c: Suggestion) =>
    edit((p) => {
      p.obligations.push({
        id: `carer-${c.payeeEmail.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
        kind: "HOUSEHOLD_EMPLOYEE",
        payeeName: c.payeeName,
        payeeEmail: c.payeeEmail,
        description: "help at home",
        amountPerPaymentMinor: c.amountPerPaymentMinor,
        maxPerMonthMinor: Math.max(c.amountPerPaymentMinor, c.amountPerPaymentMinor * (c.cadence === "WEEKLY" ? 5 : c.cadence === "BIWEEKLY" ? 3 : 1)),
        currency: "USD",
        cadence: c.cadence,
        continueForDaysAfterActivation: 60,
      });
      return p;
    });

  const edit = (fn: (p: PlanDocument) => PlanDocument) => {
    setPlan((p) => fn(structuredClone(p)));
    setSummary(null);
    setIssues([]);
  };
  const setCarer = (i: number, patch: Partial<Carer>) =>
    edit((p) => {
      p.obligations[i] = { ...p.obligations[i]!, ...patch };
      return p;
    });

  const draft = () =>
    start(async () => {
      setNote(null);
      const r = await draftFromWordsAction(words, plan.checkin.timeZone);
      if (r.ok) {
        setPlan(r.plan as PlanDocument);
        setSummary(null);
        setNote("We filled in the form from what you wrote. Check every part before you continue.");
      } else if (r.reason === "AI_OFF") {
        setNote("Writing it in your own words isn’t switched on here yet. Use the steps below instead.");
      } else {
        setNote("We couldn’t turn that into a plan safely. Use the steps below, or try different words.");
      }
    });

  const review = () =>
    start(async () => {
      const r = await previewPlanAction(plan);
      if (r.ok) {
        setSummary(r.summary);
        setIssues([]);
      } else {
        setIssues(r.issues);
        setSummary(null);
      }
    });

  const confirm = () =>
    start(async () => {
      const r = await confirmPlanAction(plan);
      if (r && !r.ok) setIssues(r.issues);
    });

  return (
    <div className="space-y-5">
      <Panel aria-labelledby="words-title">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="words-title">Say it in your own words</span>
        </Heading>
        <p className="mt-1 text-[16px] text-ink-soft">For example: keep paying Maria $320 every Friday, stop my subscriptions, and Priya is the one to call.</p>
        <textarea
          aria-labelledby="words-title"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          rows={4}
          className={`${field} resize-y leading-[1.5]`}
        />
        <button type="button" onClick={draft} disabled={pending || words.trim().length < 10} className={`${buttonStyles.soft} mt-4`}>
          Fill in the form for me
        </button>
        {note && (
          <p role="status" className="mt-3 text-[15px] text-ink-soft">
            {note}
          </p>
        )}
      </Panel>

      <Panel aria-labelledby="contact-h" className="space-y-4">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="contact-h">Your trusted contact</span>
        </Heading>
        <Field label="Their name">
          {(id) => (
            <input id={id} className={field} value={plan.trustedContact.name} onChange={(e) => edit((p) => ((p.trustedContact.name = e.target.value), p))} />
          )}
        </Field>
        <Field label="Their email" hint="We’ll only use it to reach them about you.">
          {(id) => (
            <input id={id} type="email" className={field} value={plan.trustedContact.email} onChange={(e) => edit((p) => ((p.trustedContact.email = e.target.value), p))} />
          )}
        </Field>
      </Panel>

      <Panel aria-labelledby="checkin-h" className="space-y-4">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="checkin-h">Checking in</span>
        </Heading>
        <Field label="How often should we check in?">
          {(id) => (
            <select id={id} className={field} value={plan.checkin.intervalDays} onChange={(e) => edit((p) => ((p.checkin.intervalDays = Number(e.target.value)), p))}>
              <option value={3}>Every 3 days</option>
              <option value={7}>Every week</option>
              <option value={14}>Every 2 weeks</option>
              <option value={30}>Every month</option>
            </select>
          )}
        </Field>
        <Field label="At what time?">
          {(id) => (
            <input
              id={id}
              type="time"
              className={field}
              value={`${String(plan.checkin.localHour).padStart(2, "0")}:${String(plan.checkin.localMinute).padStart(2, "0")}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                edit((p) => ((p.checkin.localHour = h ?? 10), (p.checkin.localMinute = m ?? 0), p));
              }}
            />
          )}
        </Field>
        <p className="-mt-2 text-[14px] text-ink-soft">Times are in {plan.checkin.timeZone.replaceAll("_", " ")}.</p>
        <Field label="If you miss check-ins and your contact confirms, how long should we wait before acting?" hint="Any sign of you during this time stops everything.">
          {(id) => (
            <select id={id} className={field} value={plan.waitingPeriodHours} onChange={(e) => edit((p) => ((p.waitingPeriodHours = Number(e.target.value)), p))}>
              <option value={72}>3 days</option>
              <option value={120}>5 days</option>
              <option value={168}>1 week</option>
              <option value={336}>2 weeks</option>
            </select>
          )}
        </Field>
      </Panel>

      <Panel aria-labelledby="carers-h" className="space-y-5">
        <div>
          <Heading as="h2" className="text-[1.45rem]">
            <span id="carers-h">People who work for you</span>
          </Heading>
          <p className="mt-1 text-[16px] text-ink-soft">
            Carers or helpers in your home we should keep paying for a while, so care doesn’t stop suddenly. Nobody else can be added here.
          </p>
        </div>
        <div className="rounded-[1.5rem] bg-sage/40 p-4">
          <button type="button" onClick={suggest} disabled={pending} className={buttonStyles.soft}>
            {pending ? "Looking at your payments…" : "Look at my payments and suggest"}
          </button>
          {suggestNote && (
            <p role="status" className="mt-3 text-[15px] text-ink-soft">
              {suggestNote}
            </p>
          )}
          {suggestions && suggestions.length > 0 && (
            <ul className="mt-3 space-y-3">
              {suggestions.map((c) => (
                <li key={c.payeeEmail} className="rounded-2xl bg-white/90 p-4">
                  <p className="text-[17px] font-semibold">
                    {c.payeeName}, ${(c.amountPerPaymentMinor / 100).toFixed(2)} {c.cadence === "WEEKLY" ? "a week" : c.cadence === "BIWEEKLY" ? "every 2 weeks" : "a month"}
                  </p>
                  <p className="mt-0.5 text-[15px] text-ink-soft">
                    {c.why} You’ve paid them {c.payments} times.
                  </p>
                  <button
                    type="button"
                    className={`${buttonStyles.quiet} mt-2`}
                    onClick={() => {
                      addSuggestion(c);
                      setSuggestions((xs) => xs?.filter((x) => x.payeeEmail !== c.payeeEmail) ?? null);
                    }}
                  >
                    Add {c.payeeName.split(" ")[0]} to my plan
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {plan.obligations.map((o, i) => (
          <div key={o.id} className="space-y-4 rounded-[1.5rem] bg-mist/70 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">{(id) => <input id={id} className={field} value={o.payeeName} onChange={(e) => setCarer(i, { payeeName: e.target.value })} />}</Field>
              <Field label="Their PayPal email">{(id) => <input id={id} type="email" className={field} value={o.payeeEmail} onChange={(e) => setCarer(i, { payeeEmail: e.target.value })} />}</Field>
              <Field label="Each payment ($)">
                {(id) => <input id={id} inputMode="decimal" className={field} value={dollars(o.amountPerPaymentMinor)} onChange={(e) => setCarer(i, { amountPerPaymentMinor: toMinor(e.target.value) })} />}
              </Field>
              <Field label="How often">
                {(id) => (
                  <select id={id} className={field} value={o.cadence} onChange={(e) => setCarer(i, { cadence: e.target.value as Carer["cadence"] })}>
                    <option value="WEEKLY">Every week</option>
                    <option value="BIWEEKLY">Every 2 weeks</option>
                    <option value="MONTHLY">Every month</option>
                  </select>
                )}
              </Field>
              <Field label="Never more than this a month ($)">
                {(id) => <input id={id} inputMode="decimal" className={field} value={dollars(o.maxPerMonthMinor)} onChange={(e) => setCarer(i, { maxPerMonthMinor: toMinor(e.target.value) })} />}
              </Field>
              <Field label="Keep paying for (days)">
                {(id) => (
                  <input id={id} type="number" min={0} max={120} className={field} value={o.continueForDaysAfterActivation} onChange={(e) => setCarer(i, { continueForDaysAfterActivation: Number(e.target.value) })} />
                )}
              </Field>
            </div>
            <button type="button" className={buttonStyles.quiet} onClick={() => edit((p) => ((p.obligations = p.obligations.filter((_, j) => j !== i)), p))}>
              Remove {o.payeeName || "this person"}
            </button>
          </div>
        ))}
        {plan.obligations.length < 5 && (
          <button
            type="button"
            className={buttonStyles.soft}
            onClick={() =>
              edit((p) => {
                p.obligations.push({
                  id: `carer-${Date.now().toString(36)}`,
                  kind: "HOUSEHOLD_EMPLOYEE",
                  payeeName: "",
                  payeeEmail: "",
                  description: "help at home",
                  amountPerPaymentMinor: 10000,
                  maxPerMonthMinor: 50000,
                  currency: "USD",
                  cadence: "WEEKLY",
                  continueForDaysAfterActivation: 30,
                });
                return p;
              })
            }
          >
            Add someone
          </button>
        )}
      </Panel>

      <Panel aria-labelledby="act-h" className="space-y-3">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="act-h">If your plan ever starts</span>
        </Heading>
        {(
          [
            ["cancelSubscriptions", "Stop my recurring subscriptions"],
            ["cancelOpenInvoices", "Cancel invoices I’ve sent that haven’t been paid"],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3.5 text-[17px]">
            <input type="checkbox" className="h-6 w-6 accent-green" checked={plan.onActivation[key]} onChange={(e) => edit((p) => ((p.onActivation[key] = e.target.checked), p))} />
            {text}
          </label>
        ))}
        <label className="flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3.5 text-[17px]">
          <input
            type="checkbox"
            className="h-6 w-6 accent-green"
            checked={plan.contentVisibleTo.includes("TRUSTED_CONTACT")}
            onChange={(e) =>
              edit((p) => {
                p.contentVisibleTo = e.target.checked ? ["TRUSTED_CONTACT"] : [];
                return p;
              })
            }
          />
          Let {plan.trustedContact.name || "my contact"} read my payment notes
        </label>
        <p className="text-[15px] text-ink-soft">Your remaining balance always stays safe for your estate. That part can’t be changed.</p>
      </Panel>

      {issues.length > 0 && (
        <div role="alert" className="rounded-[1.5rem] bg-[#FCEFD9] px-5 py-4 text-[16px] text-amber-ink">
          <p className="font-semibold">A few things need fixing before we can save this:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {summary ? (
        <Panel aria-labelledby="review-h" className="space-y-4">
          <Heading as="h2" className="text-[1.45rem]">
            <span id="review-h">Here’s what we’ll do</span>
          </Heading>
          <ul className="space-y-3">
            {summary.map((line) => (
              <li key={line} className="flex gap-3 text-[17px] leading-[1.55]">
                <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-mint" />
                {line}
              </li>
            ))}
          </ul>
          <button type="button" onClick={confirm} disabled={pending} className={buttonStyles.primary}>
            Confirm my plan
          </button>
        </Panel>
      ) : (
        <button type="button" onClick={review} disabled={pending} className={buttonStyles.primary}>
          Review my plan
        </button>
      )}
    </div>
  );
}
