// Mehrsprachigkeit: t('schlüssel', {param}) mit Rückfall auf Deutsch.
import de from './locales/de.js';

export const LANGS = { de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe' };
const LOCALE = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR' };

let dict = de, cur = 'de';

export async function setLang(l) {
  if (!LANGS[l]) l = 'en';
  try { dict = l === 'de' ? de : (await import(`./locales/${l}.js`)).default; cur = l; }
  catch { dict = de; cur = 'de'; }
  if (typeof document !== 'undefined') document.documentElement.lang = cur;
  return cur;
}
export const lang = () => cur;
export const locale = () => LOCALE[cur] || 'de-DE';

export function detectLang(list = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []) {
  for (const l of list || []) { const b = String(l).slice(0, 2).toLowerCase(); if (LANGS[b]) return b; }
  return 'en';
}

export function t(key, p) {
  let s = dict[key] ?? de[key] ?? key;
  if (s.includes('{')) {
    const emg = dict['emg.number'] ?? de['emg.number'];
    s = s.replace(/\{(\w+)\}/g, (m, n) => (n === 'EMG' ? emg : p && p[n] != null ? p[n] : m));
  }
  return s;
}

export const nf = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtDate = d => (d ? new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–');
export const fmtDay = d => (d ? new Date(d).toLocaleDateString(locale()) : '–');

/** Übersetzt statische Elemente mit data-i18n (innerHTML, Texte stammen nur aus den Sprachdateien). */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
}
