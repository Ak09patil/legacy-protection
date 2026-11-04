import type { Locale } from "./config";

/**
 * Messages that come back from the server are written in English and used as
 * their own keys (the gettext pattern). This catalog turns each one into
 * plain German and Spanish. scripts/check-translations.mjs fails the build if
 * the server gains a message that isn't listed here.
 */
type Entry = { de: string; es: string };

export const ERROR_CATALOG: Record<string, Entry> = {
  // Sign-up and sign-in
  "Please enter your name.": { de: "Bitte geben Sie Ihren Namen ein.", es: "Escriba su nombre, por favor." },
  "Please enter a valid email address.": { de: "Bitte geben Sie eine gültige E-Mail-Adresse ein.", es: "Escriba un correo electrónico válido, por favor." },
  "Please check your details.": { de: "Bitte prüfen Sie Ihre Angaben.", es: "Revise sus datos, por favor." },
  "This invitation has expired or was already used. Ask for a new one.": {
    de: "Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitten Sie um eine neue.",
    es: "Esta invitación ha caducado o ya se usó. Pida una nueva.",
  },
  "This invitation has expired or was already used.": {
    de: "Diese Einladung ist abgelaufen oder wurde schon benutzt.",
    es: "Esta invitación ha caducado o ya se usó.",
  },
  "There’s already an account with this email. Sign in instead.": {
    de: "Mit dieser E-Mail-Adresse gibt es schon ein Konto. Melden Sie sich stattdessen an.",
    es: "Ya hay una cuenta con este correo. Entre con ella.",
  },
  "That took too long. Please try again.": { de: "Das hat zu lange gedauert. Bitte versuchen Sie es noch einmal.", es: "Ha tardado demasiado. Inténtelo de nuevo, por favor." },
  "We couldn’t verify your passkey.": { de: "Wir konnten Ihren Fingerabdruck oder Ihr Gesicht nicht bestätigen.", es: "No pudimos comprobar su huella o su cara." },
  "We didn’t recognise that passkey.": { de: "Wir haben diesen Fingerabdruck oder dieses Gesicht nicht erkannt.", es: "No reconocimos esa huella o esa cara." },
  "Too many codes requested. Please wait a few minutes.": {
    de: "Es wurden zu viele Codes angefordert. Bitte warten Sie ein paar Minuten.",
    es: "Se han pedido demasiados códigos. Espere unos minutos, por favor.",
  },
  "That code isn’t right, or it has expired.": { de: "Dieser Code stimmt nicht oder ist abgelaufen.", es: "Ese código no es correcto o ha caducado." },
  "We couldn’t verify your passkey, so nothing has changed.": {
    de: "Wir konnten Ihren Fingerabdruck oder Ihr Gesicht nicht bestätigen. Es hat sich nichts geändert.",
    es: "No pudimos comprobar su huella o su cara, así que no ha cambiado nada.",
  },
  "There’s nothing to confirm right now.": { de: "Im Moment gibt es nichts zu bestätigen.", es: "Ahora mismo no hay nada que confirmar." },

  // Payments
  "Only the account owner can decide about a payment.": {
    de: "Nur die Kontoinhaberin oder der Kontoinhaber kann über eine Zahlung entscheiden.",
    es: "Solo el titular de la cuenta puede decidir sobre un pago.",
  },
  "Payment not found.": { de: "Zahlung nicht gefunden.", es: "No se encontró el pago." },
  "That choice isn’t available any more.": { de: "Diese Wahl gibt es nicht mehr.", es: "Esa opción ya no está disponible." },
  "Only the account owner can make payments.": { de: "Nur die Kontoinhaberin oder der Kontoinhaber kann Zahlungen machen.", es: "Solo el titular de la cuenta puede hacer pagos." },
  "Please enter their PayPal email.": { de: "Bitte geben Sie die PayPal-E-Mail-Adresse ein.", es: "Escriba su correo de PayPal, por favor." },
  "Please enter a name and a valid email.": { de: "Bitte geben Sie einen Namen und eine gültige E-Mail-Adresse ein.", es: "Escriba un nombre y un correo válido, por favor." },
  "Please check the payment.": { de: "Bitte prüfen Sie die Zahlung.", es: "Revise el pago, por favor." },
  "Who are you paying?": { de: "Wen bezahlen Sie?", es: "¿A quién le paga?" },
  "Please enter an amount like 42 or 42.50.": { de: "Bitte geben Sie einen Betrag wie 42 oder 42.50 ein.", es: "Escriba una cantidad como 42 o 42.50, por favor." },
  "Amounts from $0.01 to $100,000.": { de: "Beträge von 0,01 $ bis 100.000 $.", es: "Cantidades de 0,01 $ a 100.000 $." },

  // Plans and invitations
  "Only the owner can confirm the plan.": { de: "Nur Sie selbst können Ihren Plan bestätigen.", es: "Solo el titular puede confirmar el plan." },
  "Your trusted contact needs to be someone other than you.": {
    de: "Ihre Vertrauensperson muss jemand anderes sein als Sie.",
    es: "Su persona de confianza tiene que ser otra persona, no usted.",
  },
  "This plan has already started, so it can no longer be changed.": {
    de: "Dieser Plan hat schon begonnen. Deshalb kann er nicht mehr geändert werden.",
    es: "Este plan ya ha empezado, así que ya no se puede cambiar.",
  },
  "Only the owner can invite an executor.": {
    de: "Nur Sie selbst können jemanden für Ihren Nachlass einladen.",
    es: "Solo el titular puede invitar a quien se ocupará de sus asuntos.",
  },
  "Only the owner can invite people.": { de: "Nur Sie selbst können Menschen einladen.", es: "Solo el titular puede invitar a personas." },
  "There’s no pending invitation to resend.": { de: "Es gibt keine offene Einladung, die man erneut senden kann.", es: "No hay ninguna invitación pendiente para volver a enviar." },
  "Per-payment amount cannot exceed the monthly cap": {
    de: "Eine einzelne Zahlung darf nicht höher sein als das Monatslimit.",
    es: "Un solo pago no puede ser mayor que el límite mensual.",
  },
  "The trusted contact cannot also be a payee of the plan (INV-08)": {
    de: "Ihre Vertrauensperson kann nicht gleichzeitig Geld aus dem Plan bekommen.",
    es: "Su persona de confianza no puede recibir también dinero del plan.",
  },
  "Obligation ids must be unique": { de: "Jede Person darf nur einmal in der Liste stehen.", es: "Cada persona solo puede aparecer una vez en la lista." },
};

const FALLBACK: Record<Exclude<Locale, "en">, string> = {
  de: "Bitte prüfen Sie diesen Teil noch einmal.",
  es: "Revise esta parte otra vez, por favor.",
};

/**
 * The reader's own words for a server message. English passes through; an
 * unknown message never shows English to a German or Spanish reader, it
 * becomes a plain "please check this part".
 */
export function translateError(locale: Locale, message: string): string {
  if (locale === "en") return message;
  return ERROR_CATALOG[message]?.[locale] ?? FALLBACK[locale];
}
