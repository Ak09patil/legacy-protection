/**
 * The plan document: what the owner confirms, and the only source of
 * authority for an activated plan (INV-02).
 *
 * The schema is deliberately narrow. There is no field that could send the
 * balance or an arbitrary payment anywhere (INV-04). Continued payments exist
 * only as capped obligations to payees the owner registered by name.
 */

import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(254);
const minor = z.number().int().positive().max(10_000_000); // up to $100,000.00
const currency = z.string().regex(/^[A-Z]{3}$/);

export const TrustedContactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
  })
  .strict();

export const ObligationSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    kind: z.literal("HOUSEHOLD_EMPLOYEE"),
    payeeName: z.string().trim().min(1).max(100),
    payeeEmail: email,
    description: z.string().trim().max(200),
    amountPerPaymentMinor: minor,
    maxPerMonthMinor: minor,
    currency,
    cadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
    /** How long payments may continue after activation, so the household can arrange care. */
    continueForDaysAfterActivation: z.number().int().min(0).max(120),
  })
  .strict()
  .refine((o) => o.amountPerPaymentMinor <= o.maxPerMonthMinor, {
    message: "Per-payment amount cannot exceed the monthly cap",
  });

export const PlanDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    trustedContact: TrustedContactSchema,
    checkin: z
      .object({
        timeZone: z.string().min(1).max(64),
        intervalDays: z.number().int().min(1).max(30),
        localHour: z.number().int().min(0).max(23),
        localMinute: z.number().int().min(0).max(59),
      })
      .strict(),
    waitingPeriodHours: z.number().int().min(72).max(24 * 30),
    obligations: z.array(ObligationSchema).max(5),
    onActivation: z
      .object({
        cancelSubscriptions: z.boolean(),
        cancelOpenInvoices: z.boolean(),
        /** Always true: the balance waits for the estate. Not configurable. INV-04 */
        holdBalanceForEstate: z.literal(true),
      })
      .strict(),
    /** Roles allowed to see memo and message content (INV-17). Empty by default. */
    contentVisibleTo: z.array(z.enum(["TRUSTED_CONTACT", "EXECUTOR"])).max(2),
  })
  .strict()
  .refine((p) => p.obligations.every((o) => o.payeeEmail !== p.trustedContact.email), {
    message: "The trusted contact cannot also be a payee of the plan (INV-08)",
    path: ["obligations"],
  })
  .refine((p) => new Set(p.obligations.map((o) => o.id)).size === p.obligations.length, {
    message: "Obligation ids must be unique",
    path: ["obligations"],
  });

export type PlanDocument = z.infer<typeof PlanDocumentSchema>;
export type Obligation = z.infer<typeof ObligationSchema>;

export type SummaryLanguage = "en" | "de" | "es";

const INTL: Record<SummaryLanguage, string> = { en: "en-US", de: "de-DE", es: "es-ES" };

function money(minorUnits: number, cur: string, lang: SummaryLanguage): string {
  return new Intl.NumberFormat(INTL[lang], { style: "currency", currency: cur }).format(minorUnits / 100);
}

function clock(h: number, m: number, timeZone: string, lang: SummaryLanguage): string {
  const t =
    lang === "en"
      ? `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
      : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  let zone = timeZone;
  try {
    zone =
      new Intl.DateTimeFormat(INTL[lang], { timeZone, timeZoneName: "longGeneric" })
        .formatToParts(new Date(0))
        .find((x) => x.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    /* unknown zone: show the IANA name as given */
  }
  return lang === "en" ? `${t} ${zone}` : `${t} (${zone})`;
}

/**
 * The words of the summary, one set per language. Every number and name is
 * inserted by code from the validated document; a translation can change the
 * words around them, never the facts.
 */
interface SummaryWords {
  every: (days: number) => string;
  duration: (hours: number) => string;
  cadence: Record<"WEEKLY" | "BIWEEKLY" | "MONTHLY", string>;
  role: Record<"TRUSTED_CONTACT" | "EXECUTOR", string>;
  checkIn: (every: string, at: string) => string;
  contact: (name: string, email: string) => string;
  trigger: (name: string, wait: string) => string;
  cancelSubs: string;
  cancelInvoices: string;
  obligation: (o: { payee: string; what: string; amount: string; cadence: string; cap: string; days: number }) => string;
  balance: string;
  nobodyReads: string;
  canRead: (who: string) => string;
  and: string;
}

const WORDS: Record<SummaryLanguage, SummaryWords> = {
  en: {
    every: (d) => (d === 1 ? "every day" : d === 7 ? "every week" : d === 14 ? "every 2 weeks" : d % 7 === 0 ? `every ${d / 7} weeks` : `every ${d} days`),
    duration: (h) => (h % 168 === 0 ? (h === 168 ? "1 week" : `${h / 168} weeks`) : h % 24 === 0 ? `${h / 24} days` : `${h} hours`),
    cadence: { WEEKLY: "every week", BIWEEKLY: "every 2 weeks", MONTHLY: "every month" },
    role: { TRUSTED_CONTACT: "your trusted person", EXECUTOR: "the person who will handle your affairs" },
    checkIn: (e, at) => `We'll ask how you are ${e} at ${at}. One tap on "I'm okay" is all it takes.`,
    contact: (n, em) =>
      `Your trusted person is ${n} (${em}). They can tell us if something has happened to you. They can't change your plan, release payments or receive money from it.`,
    trigger: (n, w) =>
      `Nothing happens unless you stop answering, ${n} tells us something has happened, and then another ${w} pass with no word from you. Any sign of you stops it.`,
    cancelSubs: "If your plan starts, we'll stop your regular subscriptions.",
    cancelInvoices: "If your plan starts, we'll cancel bills you sent that haven't been paid.",
    obligation: (o) => `We'll keep paying ${o.payee} (${o.what}) ${o.amount} ${o.cadence}, never more than ${o.cap} a month, for up to ${o.days} days.`,
    balance: "Your remaining money stays safe in your account for your family. It is never sent to anyone by this plan.",
    nobodyReads: "Nobody else can read the messages that come with your payments.",
    canRead: (w) => `The messages that come with your payments can be read by: ${w}.`,
    and: " and ",
  },
  de: {
    every: (d) => (d === 1 ? "jeden Tag" : d === 7 ? "jede Woche" : d === 14 ? "alle 2 Wochen" : d % 7 === 0 ? `alle ${d / 7} Wochen` : `alle ${d} Tage`),
    duration: (h) => (h % 168 === 0 ? (h === 168 ? "1 Woche" : `${h / 168} Wochen`) : h % 24 === 0 ? `${h / 24} Tage` : `${h} Stunden`),
    cadence: { WEEKLY: "jede Woche", BIWEEKLY: "alle 2 Wochen", MONTHLY: "jeden Monat" },
    role: { TRUSTED_CONTACT: "Ihre Vertrauensperson", EXECUTOR: "die Person, die sich um Ihren Nachlass kümmert" },
    checkIn: (e, at) => `Wir fragen ${e} um ${at}, wie es Ihnen geht. Ein Tippen auf „Mir geht es gut“ genügt.`,
    contact: (n, em) =>
      `Ihre Vertrauensperson ist ${n} (${em}). Diese Person kann uns sagen, wenn Ihnen etwas passiert ist. Sie kann Ihren Plan nicht ändern, keine Zahlungen freigeben und kein Geld daraus bekommen.`,
    trigger: (n, w) =>
      `Es passiert nichts, außer Sie antworten nicht mehr, ${n} sagt uns, dass etwas passiert ist, und danach vergehen noch ${w} ohne ein Zeichen von Ihnen. Jedes Zeichen von Ihnen stoppt alles.`,
    cancelSubs: "Wenn Ihr Plan startet, kündigen wir Ihre regelmäßigen Abos.",
    cancelInvoices: "Wenn Ihr Plan startet, stornieren wir Rechnungen, die Sie verschickt haben und die noch offen sind.",
    obligation: (o) => `Wir zahlen ${o.payee} (${o.what}) weiter ${o.amount} ${o.cadence}, nie mehr als ${o.cap} pro Monat, höchstens ${o.days} Tage lang.`,
    balance: "Ihr restliches Geld bleibt sicher in Ihrem Konto, für Ihre Familie. Dieser Plan schickt es nie an irgendjemanden.",
    nobodyReads: "Niemand sonst kann die Nachrichten lesen, die mit Ihren Zahlungen kommen.",
    canRead: (w) => `Die Nachrichten, die mit Ihren Zahlungen kommen, kann lesen: ${w}.`,
    and: " und ",
  },
  es: {
    every: (d) => (d === 1 ? "cada día" : d === 7 ? "cada semana" : d === 14 ? "cada 2 semanas" : d % 7 === 0 ? `cada ${d / 7} semanas` : `cada ${d} días`),
    duration: (h) => (h % 168 === 0 ? (h === 168 ? "1 semana" : `${h / 168} semanas`) : h % 24 === 0 ? `${h / 24} días` : `${h} horas`),
    cadence: { WEEKLY: "cada semana", BIWEEKLY: "cada 2 semanas", MONTHLY: "cada mes" },
    role: { TRUSTED_CONTACT: "su persona de confianza", EXECUTOR: "la persona que se ocupará de sus asuntos" },
    checkIn: (e, at) => `Le preguntaremos cómo está ${e} a las ${at}. Basta con tocar «Estoy bien».`,
    contact: (n, em) =>
      `Su persona de confianza es ${n} (${em}). Puede avisarnos si le ha pasado algo. No puede cambiar su plan, soltar pagos ni recibir dinero de él.`,
    trigger: (n, w) =>
      `No pasa nada a menos que usted deje de contestar, ${n} nos diga que ha pasado algo, y después pasen otros ${w} sin noticias suyas. Cualquier señal suya lo para todo.`,
    cancelSubs: "Si su plan empieza, daremos de baja sus suscripciones.",
    cancelInvoices: "Si su plan empieza, anularemos las facturas que envió y que no se han pagado.",
    obligation: (o) => `Seguiremos pagando a ${o.payee} (${o.what}) ${o.amount} ${o.cadence}, nunca más de ${o.cap} al mes, durante ${o.days} días como máximo.`,
    balance: "El resto de su dinero queda a salvo en su cuenta, para su familia. Este plan nunca lo envía a nadie.",
    nobodyReads: "Nadie más puede leer los mensajes que llegan con sus pagos.",
    canRead: (w) => `Pueden leer los mensajes que llegan con sus pagos: ${w}.`,
    and: " y ",
  },
};

/**
 * Plain-language summary of exactly what the plan will do, generated by code
 * from the validated document, never by a model. This is what the owner reads
 * and confirms, in their own language.
 */
export function summarisePlan(p: PlanDocument, lang: SummaryLanguage = "en"): string[] {
  const w = WORDS[lang];
  const lines: string[] = [];
  lines.push(w.checkIn(w.every(p.checkin.intervalDays), clock(p.checkin.localHour, p.checkin.localMinute, p.checkin.timeZone, lang)));
  lines.push(w.contact(p.trustedContact.name, p.trustedContact.email));
  lines.push(w.trigger(p.trustedContact.name, w.duration(p.waitingPeriodHours)));
  if (p.onActivation.cancelSubscriptions) lines.push(w.cancelSubs);
  if (p.onActivation.cancelOpenInvoices) lines.push(w.cancelInvoices);
  for (const o of p.obligations) {
    lines.push(
      w.obligation({
        payee: o.payeeName,
        what: o.description,
        amount: money(o.amountPerPaymentMinor, o.currency, lang),
        cadence: w.cadence[o.cadence],
        cap: money(o.maxPerMonthMinor, o.currency, lang),
        days: o.continueForDaysAfterActivation,
      }),
    );
  }
  lines.push(w.balance);
  lines.push(p.contentVisibleTo.length === 0 ? w.nobodyReads : w.canRead(p.contentVisibleTo.map((r) => w.role[r]).join(w.and)));
  return lines;
}
