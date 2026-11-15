// Text-to-speech in any language, using Gemini's TTS models.
// Phones usually have voices for big languages, but a laptop browser often has no Tamil, Telugu or Odia voice.
// Each sentence is generated once and kept in a small file cache, so repeats are instant.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.join(path.dirname(process.env.DB_PATH || path.join(process.cwd(), 'data', 'saathi.db')), 'tts');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'];

// Gemini sometimes returns raw 16-bit PCM. Browsers need a WAV header in front of it.
function pcmToWav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function speechAudio(text, languageName) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Voice is not set up.');
  const clean = String(text || '').trim().slice(0, 600);
  if (!clean) throw new Error('Nothing to say.');
  const key = crypto.createHash('sha1').update(`${languageName}|${clean}`).digest('hex');
  const file = path.join(CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  let lastError = null;
  for (const model of TTS_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Say slowly, clearly and warmly, in ${languageName}: ${clean}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          },
        }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `TTS error ${res.status}`);
      const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
      if (!part) throw new Error('No audio came back.');
      const bytes = Buffer.from(part.inlineData.data, 'base64');
      const mime = String(part.inlineData.mimeType || '').toLowerCase();
      let wav = bytes;
      if (!mime.includes('wav')) {
        const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
        wav = pcmToWav(bytes, rate);
      }
      fs.writeFileSync(file, wav);
      return wav;
    } catch (err) {
      lastError = err;
      console.error(`[tts] ${model} failed:`, err.message);
    }
  }
  throw lastError || new Error('Voice failed.');
}
