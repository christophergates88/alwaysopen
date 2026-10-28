// The voices an owner can pick for Max (ElevenLabs, through Twilio ConversationRelay). Both IDs are ones Twilio's own
// ConversationRelay docs use: the first is Twilio's default US English voice, which Always Open's own line already uses.
export const VOICES = {
  calm: { id: 'UgBBYS2sOqTuMpoF3BR0', label: 'Calm and even (male)' },
  warm: { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Warm and friendly (female)' }
};
export const DEFAULT_VOICE = 'calm';
export function voiceKeyOf(id) {
  const base = String(id || '').split('-')[0];
  for (const k of Object.keys(VOICES)) if (VOICES[k].id === base) return k;
  return base ? 'custom' : DEFAULT_VOICE;
}
export function voicesOut() { return Object.keys(VOICES).map(k => ({ key: k, label: VOICES[k].label })); }
// An assistant name: letters, spaces, dots, apostrophes and hyphens, up to 30 characters.
export function cleanName(n) { return String(n || '').replace(/[^A-Za-z .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30); }
