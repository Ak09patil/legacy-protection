/**
 * Deterministic scam-language labeller. Used when no AI model is configured,
 * and alongside the model as a floor: a phrase that matches here is always
 * labelled, whatever the model says (models can only add caution, INV-11).
 */

import type { TextLabel } from "./rules.js";

// Word boundaries that work for ä, ñ, ß and friends (JavaScript's \b only knows ASCII).
const w = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

/**
 * One list per label, in every language the product speaks. German and
 * Spanish phrases are the scam scripts consumer agencies warn about in those
 * countries (Verbraucherzentrale, BSI, Policía Nacional, INCIBE): gift-card
 * and crypto demands, fake officials and tech support, and the "grandchild
 * trick" (Enkeltrick / timo del nieto).
 */
const PATTERNS: ReadonlyArray<[TextLabel, RegExp[]]> = [
  [
    "GIFT_CARD_REQUEST",
    [
      w("gift ?cards?|itunes|apple card|google play card|steam card|amazon card|vouchers?"),
      w("geschenkkarten?|gutscheine?|gutscheinkarten?|guthabenkarten?|paysafecards?|google[- ]play[- ]karten?|itunes[- ]karten?|amazon[- ]gutscheine?"),
      w("tarjetas? regalo|tarjetas? de regalo|vales?|cupones?|paysafecards?|tarjetas? (de )?google play|tarjetas? (de )?itunes|tarjetas? (de )?amazon"),
    ],
  ],
  [
    "CRYPTO_REQUEST",
    [
      w("bitcoin|btc|crypto(currency)?|usdt|tether|ethereum|eth wallet|bitcoin atm|wallet address"),
      w("kryptowährung(en)?|krypto|bitcoin[- ]automat(en)?|wallet[- ]adresse"),
      w("criptomonedas?|cripto|cajero (de )?bitcoin|monedero|dirección (de la )?cartera|billetera"),
    ],
  ],
  [
    "URGENCY",
    [
      w("urgent(ly)?|immediately|right now|today|within (the )?(hour|24 hours)|asap|don'?t tell|before it'?s too late|final notice|last chance"),
      w("dringend|sofort|umgehend|heute( noch)?|innerhalb (einer|von 24) stunden?|sagen sie niemandem|erzählen sie niemandem|letzte (mahnung|chance|warnung)|sonst wird"),
      w("urgente(mente)?|inmediatamente|ahora mismo|hoy mismo|hoy|en (una hora|24 horas)|no se lo diga a nadie|no le diga a nadie|último aviso|última oportunidad|cuanto antes"),
    ],
  ],
  [
    "IMPERSONATION_GOVERNMENT",
    [
      w("irs|social security|ssa|medicare|police|sheriff|warrant|arrest|tax (office|debt)|customs|court|federal agent|fbi"),
      w("polizei|kriminalpolizei|staatsanwalt(schaft)?|finanzamt|zoll|gericht|haftbefehl|verhaftung|bundeskriminalamt|bka|europol|steuerschulden"),
      w("policía|guardia civil|hacienda|agencia tributaria|seguridad social|juzgado|tribunal|orden de (arresto|detención)|detención|aduanas?|fiscal(ía)?"),
    ],
  ],
  [
    "IMPERSONATION_TECH_SUPPORT",
    [
      w("tech(nical)? support|microsoft|apple support|virus|hacked|refund department|account (is )?(locked|suspended|compromised)|unlock your account|remote access"),
      w("technischer? (support|kundendienst)|microsoft|virus|viren|gehackt|konto (ist |wird )?(gesperrt|gehackt)|fernzugriff|fernwartung|anydesk|teamviewer"),
      w("soporte técnico|servicio técnico|microsoft|virus|hackead[oa]|cuenta (está |será )?(bloqueada|suspendida)|desbloquear su cuenta|acceso remoto|anydesk|teamviewer"),
    ],
  ],
  [
    "IMPERSONATION_FAMILY",
    [
      w("grandma|grandpa|it'?s me|your (grandson|granddaughter|nephew|niece)|i'?m in (jail|trouble|hospital)|bail|lost my phone|new number"),
      w("oma|opa|ich bin'?s|rate mal,? wer|dein(e)? (enkel(in)?|neffe|nichte)|ich bin im (gefängnis|krankenhaus)|kaution|handy verloren|neue nummer"),
      w("abuel[oa]|soy yo|adivina quién|tu (niet[oa]|sobrin[oa])|estoy en (la cárcel|el hospital|un apuro)|fianza|perdí (el|mi) (móvil|teléfono)|número nuevo"),
    ],
  ],
];

export function keywordLabels(text: string): TextLabel[] {
  const t = text.slice(0, 2000);
  return PATTERNS.filter(([, res]) => res.some((re) => re.test(t))).map(([label]) => label);
}
