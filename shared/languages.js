// Languages the elder's screen can speak. Each name is written in its own script,
// so people can find their language even if they can't read English.
// "font" is the Baloo version for that script (by Ek Type), so every Indian language
// gets the same friendly, rounded look. Urdu, Arabic and Chinese use Noto.
export const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English', speech: 'en-IN' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', speech: 'hi-IN', font: 'Baloo 2' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', speech: 'bn-IN', font: 'Baloo Da 2' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', speech: 'mr-IN', font: 'Baloo 2' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', speech: 'te-IN', font: 'Baloo Tammudu 2' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', speech: 'ta-IN', font: 'Baloo Thambi 2' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati', speech: 'gu-IN', font: 'Baloo Bhai 2' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', speech: 'kn-IN', font: 'Baloo Tamma 2' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam', speech: 'ml-IN', font: 'Baloo Chettan 2' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', speech: 'pa-IN', font: 'Baloo Paaji 2' },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia', speech: 'or-IN', font: 'Baloo Bhaina 2' },
  { code: 'ur', native: 'اردو', english: 'Urdu', speech: 'ur-IN', rtl: true, font: 'Noto Nastaliq Urdu' },
  { code: 'ne', native: 'नेपाली', english: 'Nepali', speech: 'ne-NP', font: 'Baloo 2' },
  { code: 'es', native: 'Español', english: 'Spanish', speech: 'es-ES' },
  { code: 'fr', native: 'Français', english: 'French', speech: 'fr-FR' },
  { code: 'ar', native: 'العربية', english: 'Arabic', speech: 'ar-SA', rtl: true, font: 'Noto Naskh Arabic' },
  { code: 'pt', native: 'Português', english: 'Portuguese', speech: 'pt-BR' },
  { code: 'zh', native: '中文', english: 'Chinese', speech: 'zh-CN', font: 'Noto Sans SC' },
  { code: 'de', native: 'Deutsch', english: 'German', speech: 'de-DE' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', speech: 'id-ID' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

export function languageOf(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}
