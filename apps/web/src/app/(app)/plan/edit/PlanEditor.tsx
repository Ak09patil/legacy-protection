"use client";

import { useEffect, useId, useState, useTransition } from "react";
import type { PlanDocument } from "@lp/policy";
import { Heading, Panel, buttonStyles } from "@/components/app/ui";
import { TimeZoneField } from "./TimeZoneField";
import { useLocale, useT } from "@/i18n/client";
import { fmtMoney } from "@/i18n/format";
import { confirmPlanAction, draftFromWordsAction, previewPlanAction, suggestCarersAction } from "../../actions";

type Carer = PlanDocument["obligations"][number];

const field =
  "mt-1.5 w-full min-h-[56px] rounded-2xl border-0 bg-white/90 px-4 py-3.5 text-[18px] text-ink shadow-[inset_0_0_0_1.5px_rgba(16,36,27,0.12)] focus:shadow-[inset_0_0_0_2px_#2E5E45] focus:outline-none";
const label = "block text-[18px] font-semibold";

function Field({ label: text, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {hint && <p className="text-[16px] text-ink-soft">{hint}</p>}
      {children(id)}
    </div>
  );
}

const dollars = (minor: number) => String(minor / 100);
/** Accepts "42.50" and "42,50" alike. */
const toMinor = (s: string) => Math.round(Number(s.replace(",", ".").replace(/[^0-9.]/g, "")) * 100) || 0;

export function PlanEditor({ initial, detectTimeZone = false }: { initial: PlanDocument; detectTimeZone?: boolean }) {
  const t = useT();
  const locale = useLocale();
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
            ? t.editor.suggestFound(r.source)
            : r.dropped.length
              ? t.editor.suggestNoneRegular
              : t.editor.suggestNone,
        );
      } else {
        setSuggestions(null);
        setSuggestNote(
          {
            AI_OFF: t.editor.suggestOff,
            NO_HISTORY: t.editor.suggestNoHistory,
            PROVIDER_UNAVAILABLE: t.editor.suggestUnavailable,
            INVALID_OUTPUT: t.editor.suggestInvalid,
            TOO_MANY_STEPS: t.editor.suggestSlow,
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
        description: t.editor.helpAtHome,
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
        setNote(t.editor.wordsFilled);
      } else if (r.reason === "AI_OFF") {
        setNote(t.editor.wordsOff);
      } else {
        setNote(t.editor.wordsFailed);
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
          <span id="words-title">{t.editor.wordsTitle}</span>
        </Heading>
        <p className="mt-1 text-[17px] text-ink-soft">{t.editor.wordsExample}</p>
        <textarea
          aria-labelledby="words-title"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          rows={4}
          className={`${field} resize-y leading-[1.5]`}
        />
        <button type="button" onClick={draft} disabled={pending || words.trim().length < 10} className={`${buttonStyles.soft} mt-4`}>
          {t.editor.fillForMe}
        </button>
        {note && (
          <p role="status" className="mt-3 text-[17px] text-ink-soft">
            {note}
          </p>
        )}
      </Panel>

      <Panel aria-labelledby="contact-h" className="space-y-4">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="contact-h">{t.editor.personTitle}</span>
        </Heading>
        <p className="text-[17px] text-ink-soft">{t.editor.personLead}</p>
        <Field label={t.editor.theirName}>
          {(id) => (
            <input id={id} className={field} value={plan.trustedContact.name} onChange={(e) => edit((p) => ((p.trustedContact.name = e.target.value), p))} />
          )}
        </Field>
        <Field label={t.editor.theirEmail} hint={t.editor.theirEmailHelp}>
          {(id) => (
            <input id={id} type="email" className={field} value={plan.trustedContact.email} onChange={(e) => edit((p) => ((p.trustedContact.email = e.target.value), p))} />
          )}
        </Field>
      </Panel>

      <Panel aria-labelledby="checkin-h" className="space-y-4">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="checkin-h">{t.editor.checkInTitle}</span>
        </Heading>
        <p className="text-[17px] text-ink-soft">{t.editor.checkInLead}</p>
        <Field label={t.editor.howOften}>
          {(id) => (
            <select id={id} className={field} value={plan.checkin.intervalDays} onChange={(e) => edit((p) => ((p.checkin.intervalDays = Number(e.target.value)), p))}>
              <option value={3}>{t.editor.every3}</option>
              <option value={7}>{t.editor.everyWeek}</option>
              <option value={14}>{t.editor.every2Weeks}</option>
              <option value={30}>{t.editor.everyMonth}</option>
            </select>
          )}
        </Field>
        <Field label={t.editor.atWhatTime}>
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
        <TimeZoneField className={field} value={plan.checkin.timeZone} onChange={(tz) => edit((p) => ((p.checkin.timeZone = tz), p))} />
        <Field label={t.editor.waitTitle} hint={t.editor.waitHelp}>
          {(id) => (
            <select id={id} className={field} value={plan.waitingPeriodHours} onChange={(e) => edit((p) => ((p.waitingPeriodHours = Number(e.target.value)), p))}>
              <option value={72}>{t.editor.wait3}</option>
              <option value={120}>{t.editor.wait5}</option>
              <option value={168}>{t.editor.wait7}</option>
              <option value={336}>{t.editor.wait14}</option>
            </select>
          )}
        </Field>
      </Panel>

      <Panel aria-labelledby="carers-h" className="space-y-5">
        <div>
          <Heading as="h2" className="text-[1.45rem]">
            <span id="carers-h">{t.editor.carersTitle}</span>
          </Heading>
          <p className="mt-1 text-[17px] text-ink-soft">{t.editor.carersLead}</p>
        </div>
        <div className="rounded-[1.5rem] bg-sage/40 p-4">
          <button type="button" onClick={suggest} disabled={pending} className={buttonStyles.soft}>
            {pending ? t.editor.suggesting : t.editor.suggest}
          </button>
          {suggestNote && (
            <p role="status" className="mt-3 text-[17px] text-ink-soft">
              {suggestNote}
            </p>
          )}
          {suggestions && suggestions.length > 0 && (
            <ul className="mt-3 space-y-3">
              {suggestions.map((c) => (
                <li key={c.payeeEmail} className="rounded-2xl bg-white/90 p-4">
                  <p className="text-[18px] font-semibold">
                    {t.editor.suggestLine(
                      c.payeeName,
                      fmtMoney(locale, c.amountPerPaymentMinor),
                      c.cadence === "WEEKLY" ? t.editor.perWeek : c.cadence === "BIWEEKLY" ? t.editor.per2Weeks : t.editor.perMonth,
                    )}
                  </p>
                  <p className="mt-0.5 text-[17px] text-ink-soft">{t.editor.paidTimes(c.why, c.payments)}</p>
                  <button
                    type="button"
                    className={`${buttonStyles.quiet} mt-2`}
                    onClick={() => {
                      addSuggestion(c);
                      setSuggestions((xs) => xs?.filter((x) => x.payeeEmail !== c.payeeEmail) ?? null);
                    }}
                  >
                    {t.editor.addToPlan(c.payeeName.split(" ")[0] ?? c.payeeName)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {plan.obligations.map((o, i) => (
          <div key={o.id} className="space-y-4 rounded-[1.5rem] bg-mist/70 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.editor.name}>{(id) => <input id={id} className={field} value={o.payeeName} onChange={(e) => setCarer(i, { payeeName: e.target.value })} />}</Field>
              <Field label={t.editor.theirPaypal}>{(id) => <input id={id} type="email" className={field} value={o.payeeEmail} onChange={(e) => setCarer(i, { payeeEmail: e.target.value })} />}</Field>
              <Field label={t.editor.eachPayment}>
                {(id) => <input id={id} inputMode="decimal" className={field} value={dollars(o.amountPerPaymentMinor)} onChange={(e) => setCarer(i, { amountPerPaymentMinor: toMinor(e.target.value) })} />}
              </Field>
              <Field label={t.editor.cadence}>
                {(id) => (
                  <select id={id} className={field} value={o.cadence} onChange={(e) => setCarer(i, { cadence: e.target.value as Carer["cadence"] })}>
                    <option value="WEEKLY">{t.editor.everyWeek}</option>
                    <option value="BIWEEKLY">{t.editor.every2Weeks}</option>
                    <option value="MONTHLY">{t.editor.everyMonth}</option>
                  </select>
                )}
              </Field>
              <Field label={t.editor.neverMore}>
                {(id) => <input id={id} inputMode="decimal" className={field} value={dollars(o.maxPerMonthMinor)} onChange={(e) => setCarer(i, { maxPerMonthMinor: toMinor(e.target.value) })} />}
              </Field>
              <Field label={t.editor.keepPaying}>
                {(id) => (
                  <input id={id} type="number" min={0} max={120} className={field} value={o.continueForDaysAfterActivation} onChange={(e) => setCarer(i, { continueForDaysAfterActivation: Number(e.target.value) })} />
                )}
              </Field>
            </div>
            <button type="button" className={buttonStyles.quiet} onClick={() => edit((p) => ((p.obligations = p.obligations.filter((_, j) => j !== i)), p))}>
              {t.editor.remove(o.payeeName || t.editor.thisPerson)}
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
                  description: t.editor.helpAtHome,
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
            {t.editor.addSomeone}
          </button>
        )}
      </Panel>

      <Panel aria-labelledby="act-h" className="space-y-3">
        <Heading as="h2" className="text-[1.45rem]">
          <span id="act-h">{t.editor.startsTitle}</span>
        </Heading>
        {(
          [
            ["cancelSubscriptions", t.editor.stopSubs],
            ["cancelOpenInvoices", t.editor.cancelInvoices],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-white/80 px-4 py-3.5 text-[18px]">
            <input type="checkbox" className="h-6 w-6 accent-green" checked={plan.onActivation[key]} onChange={(e) => edit((p) => ((p.onActivation[key] = e.target.checked), p))} />
            {text}
          </label>
        ))}
        <label className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-white/80 px-4 py-3.5 text-[18px]">
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
          {t.editor.letRead(plan.trustedContact.name || t.editor.myPerson)}
        </label>
        <p className="text-[17px] text-ink-soft">{t.editor.balanceSafe}</p>
      </Panel>

      {issues.length > 0 && (
        <div role="alert" className="rounded-[1.5rem] bg-[#FCEFD9] px-5 py-4 text-[17px] text-amber-ink">
          <p className="font-semibold">{t.editor.fixFirst}</p>
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
            <span id="review-h">{t.editor.reviewTitle}</span>
          </Heading>
          <ul className="space-y-3">
            {summary.map((line) => (
              <li key={line} className="flex gap-3 text-[18px] leading-[1.6]">
                <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-mint" />
                {line}
              </li>
            ))}
          </ul>
          <button type="button" onClick={confirm} disabled={pending} className={buttonStyles.primary}>
            {t.editor.confirm}
          </button>
        </Panel>
      ) : (
        <button type="button" onClick={review} disabled={pending} className={buttonStyles.primary}>
          {t.editor.review}
        </button>
      )}
    </div>
  );
}
