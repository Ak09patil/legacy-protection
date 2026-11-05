/**
 * Every email the product sends, in each person's own language.
 *
 * The recipient's language comes from their account (users.locale). People we
 * invite don't have an account yet, so their invitation is written in the
 * language of the person who invited them: families usually share one.
 *
 * Same writing rules as the screens: short sentences, say what will and won't
 * happen, never rush, never guilt.
 */

export type EmailLocale = "en" | "de" | "es";
export type Email = readonly [subject: string, body: string];

export function emailLocale(x: unknown): EmailLocale {
  return x === "de" || x === "es" ? x : "en";
}

const INTL: Record<EmailLocale, string> = { en: "en-US", de: "de-DE", es: "es-ES" };

export function emailMoney(locale: EmailLocale, minor: number | string, currency = "USD"): string {
  return new Intl.NumberFormat(INTL[locale], { style: "currency", currency }).format(Number(minor) / 100);
}

interface Templates {
  /** Bodies with {{link}} carry a one-tap "I'm okay" link, filled in at delivery. */
  checkinReminder: () => Email;
  contactCheckinMissed: (owner: string, origin: string) => Email;
  ownerContactConfirmed: (owner: string, contact: string | null) => Email;
  ownerWaitingStarted: () => Email;
  ownerActivated: (origin: string) => Email;
  contactOwnerIsOkay: (owner: string) => Email;
  contactActivated: (owner: string, origin: string) => Email;
  paymentAskContact: (owner: string, amount: string) => Email;
  paymentSendAnyway: (owner: string, amount: string) => Email;
  inviteContact: (owner: string) => Email;
  inviteExecutor: (owner: string) => Email;
  signInCode: (code: string) => Email;
  scamReported: (owner: string, amount: string) => Email;
  paymentFailed: (payee: string, amount: string) => Email;
}

const en: Templates = {
  checkinReminder: () => ["Are you okay?", `One tap on this link lets us know you’re well. You don’t need to sign in.\n\n{{link}}`],
  contactCheckinMissed: (n, o) => [
    `We haven’t heard from ${n}`,
    `${n} hasn’t answered us. That can happen for ordinary reasons.\n\nPlease try to reach them first: call, send a message, or ask someone nearby to look in.\n\nIf you know something has happened, you can tell us here: ${o}/contact`,
  ],
  ownerContactConfirmed: (n, k) => [
    `Are you okay, ${n}?`,
    `${k ?? "Your trusted person"} told us something may have happened to you. If you’re okay, tap this link. Then nothing will happen. You don’t need to sign in.\n\n{{link}}`,
  ],
  ownerWaitingStarted: () => ["Your plan will start unless we hear from you", `If you’re okay, one tap on this link stops everything. You don’t need to sign in.\n\n{{link}}`],
  ownerActivated: (o) => ["Your plan has started", `Your plan started because we didn’t hear from you. Your money is safe for your family.\n\n${o}/home`],
  contactOwnerIsOkay: (n) => [`${n} is okay`, `${n} let us know they’re well, so nothing will happen. Thank you for looking out for them.`],
  contactActivated: (n, o) => [`${n}’s plan has started`, `Their money stays safe for their family, and the person handling their affairs has what they need.\n\n${o}/contact`],
  paymentAskContact: (n, a) => [`${n} would like to talk about a payment`, `We paused a payment of ${a} from ${n} to someone new. ${n} asked to talk it over with you. Please give them a call.`],
  paymentSendAnyway: (n, a) => [
    `${n} chose to send a paused payment`,
    `${n} chose to send ${a} to someone new. We had paused it. It goes in 24 hours unless they change their mind.\n\nIf this looks like a scam, please call them now.`,
  ],
  inviteContact: (n) => [
    `${n} would like you to be their trusted person`,
    `${n} uses Legacy Protection on their PayPal account. They would like you to be their trusted person.\n\nIf something unusual happens, we’ll tell you. You can never move or receive their money.\n\nSay yes within 7 days: {{link}}`,
  ],
  inviteExecutor: (n) => [
    `${n} has chosen you to handle their affairs`,
    `If ${n}’s plan ever starts, you’ll get a clear record of what happened to their PayPal account. Until then, you can’t see anything.\n\nSay yes within 7 days: {{link}}`,
  ],
  scamReported: (n, a) => [
    `${n} has been scammed`,
    `${n} told us that a payment of ${a} was a scam. Please call ${n} today. It's not their fault: these scams fool careful people every day.\n\nThey should tell PayPal straight away, using the PayPal app or the number on paypal.com, never a number from the scammer. They shouldn't send any more money, even if someone promises to get it back.`,
  ],
  paymentFailed: (p, a) => [`Your payment to ${p} wasn’t sent`, `We couldn’t send ${a} to ${p} through PayPal. No money left your account.\n\nYou can try again in Legacy Protection. If it keeps happening, please check their PayPal email address.`],
  signInCode: (c) => [`Your Legacy Protection code: ${c}`, `Your code is ${c}. It works once, for 10 minutes.\n\nIf you didn’t ask for this, you can ignore this email. Nobody can use it without your email inbox.`],
};

const de: Templates = {
  checkinReminder: () => ["Geht es Ihnen gut?", `Ein Tippen auf diesen Link sagt uns, dass es Ihnen gut geht. Sie müssen sich nicht anmelden.\n\n{{link}}`],
  contactCheckinMissed: (n, o) => [
    `Wir haben nichts von ${n} gehört`,
    `${n} hat uns nicht geantwortet. Das kann ganz normale Gründe haben.\n\nVersuchen Sie bitte zuerst, die Person zu erreichen: anrufen, eine Nachricht schicken oder jemanden in der Nähe bitten, vorbeizuschauen.\n\nWenn Sie wissen, dass etwas passiert ist, können Sie es uns hier sagen: ${o}/contact`,
  ],
  ownerContactConfirmed: (n, k) => [
    `Geht es Ihnen gut, ${n}?`,
    `${k ?? "Ihre Vertrauensperson"} hat uns gesagt, dass Ihnen vielleicht etwas passiert ist. Wenn es Ihnen gut geht, tippen Sie auf diesen Link. Dann passiert nichts. Sie müssen sich nicht anmelden.\n\n{{link}}`,
  ],
  ownerWaitingStarted: () => ["Ihr Plan startet, wenn wir nichts von Ihnen hören", `Wenn es Ihnen gut geht, stoppt ein Tippen auf diesen Link alles. Sie müssen sich nicht anmelden.\n\n{{link}}`],
  ownerActivated: (o) => ["Ihr Plan hat begonnen", `Ihr Plan hat begonnen, weil wir nichts von Ihnen gehört haben. Ihr Geld bleibt sicher für Ihre Familie.\n\n${o}/home`],
  contactOwnerIsOkay: (n) => [`${n} geht es gut`, `${n} hat uns gesagt, dass alles gut ist. Es passiert also nichts. Danke, dass Sie auf ${n} achten.`],
  contactActivated: (n, o) => [`Der Plan von ${n} hat begonnen`, `Das Geld bleibt sicher für die Familie, und die Person, die sich um den Nachlass kümmert, hat alles, was sie braucht.\n\n${o}/contact`],
  paymentAskContact: (n, a) => [`${n} möchte mit Ihnen über eine Zahlung sprechen`, `Wir haben eine Zahlung von ${a} von ${n} an jemand Neues angehalten. ${n} möchte es mit Ihnen besprechen. Bitte rufen Sie an.`],
  paymentSendAnyway: (n, a) => [
    `${n} möchte eine angehaltene Zahlung trotzdem senden`,
    `${n} möchte ${a} an jemand Neues senden. Wir hatten die Zahlung angehalten. Sie geht in 24 Stunden raus, außer ${n} überlegt es sich anders.\n\nWenn das nach Betrug aussieht, rufen Sie bitte jetzt an.`,
  ],
  inviteContact: (n) => [
    `${n} möchte, dass Sie die Vertrauensperson sind`,
    `${n} nutzt Legacy Protection für das PayPal-Konto und möchte, dass Sie die Vertrauensperson sind.\n\nWenn etwas Ungewöhnliches passiert, sagen wir Ihnen Bescheid. Sie können das Geld nie bewegen oder bekommen.\n\nSagen Sie innerhalb von 7 Tagen zu: {{link}}`,
  ],
  inviteExecutor: (n) => [
    `${n} hat Sie gewählt, um sich um den Nachlass zu kümmern`,
    `Wenn der Plan von ${n} einmal startet, bekommen Sie einen klaren Bericht darüber, was mit dem PayPal-Konto passiert ist. Bis dahin sehen Sie nichts.\n\nSagen Sie innerhalb von 7 Tagen zu: {{link}}`,
  ],
  scamReported: (n, a) => [
    `${n} wurde betrogen`,
    `${n} hat uns gesagt, dass eine Zahlung von ${a} Betrug war. Bitte rufen Sie ${n} heute an. Es ist nicht die Schuld von ${n}: Diese Betrüger täuschen jeden Tag auch vorsichtige Menschen.\n\n${n} sollte es sofort PayPal sagen, über die PayPal-App oder die Nummer auf paypal.com, nie über eine Nummer vom Betrüger. Bitte kein weiteres Geld schicken, auch wenn jemand verspricht, es zurückzuholen.`,
  ],
  paymentFailed: (p, a) => [`Ihre Zahlung an ${p} wurde nicht gesendet`, `Wir konnten ${a} nicht über PayPal an ${p} senden. Es ist kein Geld abgegangen.\n\nSie können es in Legacy Protection noch einmal versuchen. Wenn es wieder passiert, prüfen Sie bitte die PayPal-E-Mail-Adresse.`],
  signInCode: (c) => [`Ihr Legacy-Protection-Code: ${c}`, `Ihr Code ist ${c}. Er gilt einmal und 10 Minuten lang.\n\nWenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren. Ohne Ihr E-Mail-Postfach kann niemand den Code benutzen.`],
};

const es: Templates = {
  checkinReminder: () => ["¿Está bien?", `Un toque en este enlace nos dice que está bien. No hace falta entrar en su cuenta.\n\n{{link}}`],
  contactCheckinMissed: (n, o) => [
    `No hemos sabido nada de ${n}`,
    `${n} no nos ha contestado. Puede pasar por motivos normales.\n\nIntente primero hablar con esa persona: llámela, envíele un mensaje o pida a alguien cercano que vaya a verla.\n\nSi sabe que ha pasado algo, puede decírnoslo aquí: ${o}/contact`,
  ],
  ownerContactConfirmed: (n, k) => [
    `¿Está bien, ${n}?`,
    `${k ?? "Su persona de confianza"} nos ha dicho que quizá le ha pasado algo. Si está bien, toque este enlace. Así no pasará nada. No hace falta entrar en su cuenta.\n\n{{link}}`,
  ],
  ownerWaitingStarted: () => ["Su plan empezará si no sabemos nada de usted", `Si está bien, un toque en este enlace lo para todo. No hace falta entrar en su cuenta.\n\n{{link}}`],
  ownerActivated: (o) => ["Su plan ha empezado", `Su plan empezó porque no supimos nada de usted. Su dinero está a salvo para su familia.\n\n${o}/home`],
  contactOwnerIsOkay: (n) => [`${n} está bien`, `${n} nos ha dicho que está bien, así que no pasará nada. Gracias por cuidar de esa persona.`],
  contactActivated: (n, o) => [`El plan de ${n} ha empezado`, `Su dinero queda a salvo para su familia, y la persona que se ocupa de sus asuntos tiene lo que necesita.\n\n${o}/contact`],
  paymentAskContact: (n, a) => [`${n} quiere hablar con usted de un pago`, `Hemos parado un pago de ${a} de ${n} a alguien nuevo. ${n} quiere hablarlo con usted. Llámele, por favor.`],
  paymentSendAnyway: (n, a) => [
    `${n} ha decidido enviar un pago que habíamos parado`,
    `${n} ha decidido enviar ${a} a alguien nuevo. Lo habíamos parado. Saldrá dentro de 24 horas, a menos que cambie de idea.\n\nSi parece una estafa, llámele ahora, por favor.`,
  ],
  inviteContact: (n) => [
    `${n} quiere que usted sea su persona de confianza`,
    `${n} usa Legacy Protection en su cuenta de PayPal y quiere que usted sea su persona de confianza.\n\nSi pasa algo raro, se lo diremos. Nunca podrá mover ni recibir su dinero.\n\nDiga que sí antes de 7 días: {{link}}`,
  ],
  inviteExecutor: (n) => [
    `${n} le ha elegido para ocuparse de sus asuntos`,
    `Si el plan de ${n} empieza algún día, recibirá un informe claro de lo que pasó con su cuenta de PayPal. Hasta entonces, no podrá ver nada.\n\nDiga que sí antes de 7 días: {{link}}`,
  ],
  scamReported: (n, a) => [
    `${n} ha sufrido una estafa`,
    `${n} nos ha dicho que un pago de ${a} fue una estafa. Llame hoy a ${n}, por favor. No es culpa suya: estas estafas engañan cada día a personas prudentes.\n\n${n} debe avisar a PayPal enseguida, desde la aplicación de PayPal o el número de paypal.com, nunca un número del estafador. No debe enviar más dinero, aunque alguien prometa recuperarlo.`,
  ],
  paymentFailed: (p, a) => [`Su pago a ${p} no se envió`, `No pudimos enviar ${a} a ${p} por PayPal. No ha salido dinero de su cuenta.\n\nPuede intentarlo otra vez en Legacy Protection. Si vuelve a pasar, compruebe su correo de PayPal.`],
  signInCode: (c) => [`Su código de Legacy Protection: ${c}`, `Su código es ${c}. Sirve una sola vez, durante 10 minutos.\n\nSi no lo ha pedido, puede ignorar este correo. Nadie puede usarlo sin su bandeja de entrada.`],
};

export const EMAILS: Record<EmailLocale, Templates> = { en, de, es };
