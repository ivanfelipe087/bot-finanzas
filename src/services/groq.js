import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk';
import { config } from '../config.js';

let groq = null;

function getGroqClient() {
  if (!groq) {
    if (!config.groqApiKey) {
      throw new Error('GROQ_API_KEY no está configurada en .env');
    }
    groq = new Groq({ apiKey: config.groqApiKey });
  }
  return groq;
}

/**
 * Transcribe un buffer de audio usando Groq Whisper (whisper-large-v3)
 * @param {Buffer} audioBuffer - Buffer del audio descargado de WhatsApp
 * @param {string} mimeType - Formato del audio (usualmente audio/ogg o audio/mp4)
 * @returns {Promise<string>} Texto transcrito
 */
export async function transcribirAudio(audioBuffer, mimeType = 'audio/ogg') {
  const client = getGroqClient();

  const extension = mimeType.includes('mp4') ? 'm4a' : 'ogg';
  const file = await toFile(audioBuffer, `voice_note.${extension}`, { type: mimeType });

  const response = await client.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3',
    language: 'es',
    temperature: 0.0,
  });

  return response.text?.trim() || '';
}

/**
 * Procesa el texto (transcrito o escrito) con Groq Llama 3.3 70B en Modo JSON
 * @param {string} mensajeTexto - Texto del usuario
 * @returns {Promise<object>} Objeto JSON con la acción y datos estructurados
 */
export async function procesarMensajeConIA(mensajeTexto) {
  const client = getGroqClient();

  const systemPrompt = `
Eres el cerebro de un bot de finanzas personales para WhatsApp en Colombia (Santander / Bucaramanga).
Tu tarea es analizar el mensaje del usuario y devolver SIEMPRE un JSON válido con la acción correspondiente.

REGLAS DE INTERPRETACIÓN MONETARIA EN COLOMBIA:
- "1 luca" / "1 luka" = 1000 pesos
- "4 lucas" = 4000 pesos
- "15k" / "15 k" = 15000 pesos
- "1 barra" / "1 barraza" = 1000 o 1000000 según contexto cotidiano (por defecto comida/transporte = 1000)
- "medio palo" / "medio millón" = 500000 pesos
- "un palo" = 1000000 pesos
- Los montos deben ser SIEMPRE números enteros sin puntos ni comas (ejemplo: 15000, no "$15.000").

CATEGORÍAS ESTÁNDAR:
comida, transporte, servicios, ocio, salud, educacion, compras, otros.

ACCIONES POSIBLES:

1. REGISTRAR GASTOS (cuando el usuario menciona que pagó, gastó, compró algo, o simplemente dice montos y cosas):
Si en un solo mensaje hay múltiples gastos, sepáralos en la lista.
Formato de respuesta:
{
  "accion": "registrar_gastos",
  "gastos": [
    {
      "monto": 15000,
      "categoria": "comida",
      "descripcion": "almuerzo en la UTS"
    },
    {
      "monto": 3000,
      "categoria": "transporte",
      "descripcion": "pasaje de metrolínea"
    }
  ]
}

2. CONSULTAR GASTOS DE HOY:
Si el usuario pregunta: "¿cuánto he gastado hoy?", "¿total de hoy?", "gastos hoy", "saldo hoy", etc.
{
  "accion": "consultar_hoy"
}

3. CONSULTAR GASTOS DEL MES:
Si el usuario pregunta: "¿cómo voy este mes?", "resumen del mes", "total del mes", "gastos de este mes", etc.
{
  "accion": "consultar_mes"
}

4. ELIMINAR ÚLTIMO GASTO:
Si el usuario dice: "borra el último gasto", "me equivoqué", "cancela el anterior", "eliminar último", etc.
{
  "accion": "eliminar_ultimo"
}

5. SALUDO O AYUDA:
Si el usuario saluda o pide instrucciones ("hola", "cómo funciona", "ayuda"):
{
  "accion": "ayuda",
  "mensaje": "¡Hola! Soy tu asistente de finanzas. Puedes enviarme un audio o texto diciendo tus gastos (ej: '15 lucas de almuerzo y 3 mil de bus'), o preguntarme '¿cuánto he gastado hoy?' o 'resumen del mes'."
}

6. MENSAJE NO RECONOCIDO:
Si el mensaje no tiene sentido financiero:
{
  "accion": "desconocido",
  "mensaje": "No alcancé a entender si fue un gasto o una consulta. Prueba diciendo algo como: 'Pagué 10k de empanadas' o preguntando '¿cuánto gasté hoy?'"
}

IMPORTANTE: Responde ÚNICAMENTE con el objeto JSON puro, sin explicaciones ni markdown envolvente.
`.trim();

  const completion = await client.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: mensajeTexto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  const rawJson = completion.choices[0]?.message?.content || '{}';
  return JSON.parse(rawJson);
}
