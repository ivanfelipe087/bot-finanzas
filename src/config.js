import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  groqApiKey: process.env.GROQ_API_KEY || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramUserId: process.env.TELEGRAM_USER_ID || '',
  allowedNumbers: process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean)
    : [],
};

export function validateConfig() {
  const missing = [];
  if (!config.groqApiKey || config.groqApiKey === 'tu_groq_api_key_aqui') {
    missing.push('GROQ_API_KEY');
  }
  if (!config.supabaseUrl || config.supabaseUrl.includes('tu-proyecto.supabase.co')) {
    missing.push('SUPABASE_URL');
  }
  if (!config.supabaseKey || config.supabaseKey.includes('tu_supabase_anon')) {
    missing.push('SUPABASE_KEY');
  }

  if (missing.length > 0) {
    console.warn(`\n⚠️  Faltan variables de entorno en el archivo .env: ${missing.join(', ')}`);
    console.warn(`👉 Edita el archivo 'bot-finanzas/.env' con tus credenciales reales para que funcione.\n`);
    return false;
  }
  return true;
}
