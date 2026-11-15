// What a medicine is FOR, as a picture and a simple word.
// Elders often can't read or say "Atorvastatin", but they know "my cholesterol medicine".
// The screen shows: Atorvastatin (cholesterol medicine), in the elder's own language.
// Used by both the server and the React app.

export const CATEGORIES = [
  { key: 'sugar', emoji: '🩸', label: 'Sugar medicine', words: ['sugar', 'diabet', 'glucose', 'metformin', 'glimepiride', 'gliclazide', 'insulin', 'sitagliptin', 'vildagliptin', 'teneligliptin', 'dapagliflozin', 'empagliflozin', 'voglibose'] },
  { key: 'bp', emoji: '💓', label: 'BP medicine', words: ['blood pressure', 'bp', 'hypertension', 'amlodipine', 'telmisartan', 'losartan', 'olmesartan', 'ramipril', 'enalapril', 'cilnidipine', 'metoprolol', 'atenolol'] },
  { key: 'heart', emoji: '❤️', label: 'Heart medicine', words: ['heart', 'cardiac', 'angina', 'nitrate', 'isosorbide', 'digoxin', 'ivabradine'] },
  { key: 'thinner', emoji: '💧', label: 'Blood thinner', words: ['blood thin', 'thinner', 'clot', 'aspirin', 'ecosprin', 'clopidogrel', 'warfarin', 'apixaban', 'rivaroxaban'] },
  { key: 'cholesterol', emoji: '🫀', label: 'Cholesterol medicine', words: ['cholesterol', 'lipid', 'statin', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'fenofibrate'] },
  { key: 'pain', emoji: '🦵', label: 'Pain medicine', words: ['pain', 'arthritis', 'joint', 'knee', 'back', 'diclofenac', 'aceclofenac', 'ibuprofen', 'tramadol', 'etoricoxib'] },
  { key: 'headache', emoji: '🤕', label: 'Headache medicine', words: ['headache', 'migraine'] },
  { key: 'fever', emoji: '🌡️', label: 'Fever medicine', words: ['fever', 'paracetamol', 'dolo', 'crocin', 'calpol'] },
  { key: 'acidity', emoji: '🔥', label: 'Gas and acidity medicine', words: ['acid', 'gas', 'ulcer', 'reflux', 'heartburn', 'pantoprazole', 'omeprazole', 'rabeprazole', 'esomeprazole', 'ranitidine', 'famotidine', 'pan 40', 'pan-d'] },
  { key: 'stomach', emoji: '🌿', label: 'Stomach and toilet medicine', words: ['constipation', 'motion', 'laxative', 'isabgol', 'lactulose', 'loose', 'diarrh', 'digest'] },
  { key: 'bones', emoji: '🦴', label: 'Bone strength medicine', words: ['bone', 'calcium', 'shelcal', 'osteo', 'vitamin d', 'd3', 'cholecalciferol'] },
  { key: 'vitamin', emoji: '🍊', label: 'Vitamin', words: ['vitamin', 'multivit', 'b12', 'iron', 'folic', 'zinc', 'supplement', 'tonic'] },
  { key: 'thyroid', emoji: '🦋', label: 'Thyroid medicine', words: ['thyroid', 'thyroxine', 'levothyroxine', 'thyronorm', 'eltroxin'] },
  { key: 'sleep', emoji: '😴', label: 'Sleep medicine', words: ['sleep', 'insomnia', 'zolpidem', 'melatonin', 'alprazolam', 'clonazepam'] },
  { key: 'breathing', emoji: '🫁', label: 'Breathing medicine', words: ['breath', 'asthma', 'copd', 'inhaler', 'salbutamol', 'budesonide', 'montelukast', 'deriphyllin', 'cough'] },
  { key: 'infection', emoji: '🦠', label: 'Infection medicine', words: ['infection', 'antibiotic', 'amoxicillin', 'azithromycin', 'ciprofloxacin', 'cefixime', 'doxycycline', 'augmentin'] },
  { key: 'allergy', emoji: '🤧', label: 'Allergy medicine', words: ['allerg', 'cetirizine', 'levocetirizine', 'fexofenadine', 'itch', 'sneez'] },
  { key: 'eyes', emoji: '👁️', label: 'Eye medicine', words: ['eye', 'glaucoma', 'cataract', 'timolol', 'drops for eye'] },
  { key: 'mind', emoji: '🧠', label: 'Memory and mood medicine', words: ['memory', 'dementia', 'mood', 'depress', 'anxiety', 'donepezil', 'sertraline', 'escitalopram', 'parkinson'] },
  { key: 'kidney', emoji: '💦', label: 'Kidney and urine medicine', words: ['kidney', 'urine', 'prostate', 'tamsulosin', 'diuretic', 'furosemide', 'lasix', 'torsemide'] },
  { key: 'other', emoji: '💊', label: 'Other medicine', words: [] },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function categoryOf(key) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1];
}

// Guesses the category from the medicine name and what it's for, e.g. "Metformin" -> sugar.
export function guessCategory(...texts) {
  const text = texts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'other';
  for (const c of CATEGORIES) {
    for (const w of c.words) {
      if (w.length <= 3 ? new RegExp(`\\b${w}\\b`).test(text) : text.includes(w)) return c.key;
    }
  }
  return 'other';
}
