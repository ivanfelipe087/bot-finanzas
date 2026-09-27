import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import { fileURLToPath } from 'url';

import { config, validateConfig } from './config.js';
import { transcribirAudio, procesarMensajeConIA } from './services/groq.js';
import {
  registrarGastos,
  getResumenHoy,
  getResumenMes,
  eliminarUltimoGasto,
} from './services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authFolder = path.resolve(__dirname, '../auth_info_baileys');

// Logger silencioso para Baileys (evita saturar la consola)
const logger = pino({ level: 'silent' });

// Formateador de moneda en pesos colombianos
function formatCOP(num) {
  return '$' + Math.round(Number(num)).toLocaleString('es-CO');
}

// Iconos por categoría
const CATEGORIA_ICONS = {
  comida: '🍔',
  transporte: '🚌',
  servicios: '💡',
  ocio: '🎮',
  salud: '💊',
  educacion: '📚',
  compras: '🛍️',
  ropa: '👕',
  otros: '📌',
};

function getCatIcon(cat) {
  return CATEGORIA_ICONS[cat?.toLowerCase()] || '📌';
}

// Set para rastrear IDs de mensajes enviados por el bot y evitar auto-respuestas/loops
const sentMessageIds = new Set();

async function startBot() {
  console.log('\n=============================================');
  console.log('🤖 INICIANDO BOT DE FINANZAS PERSONALES');
  console.log('=============================================\n');

  if (!validateConfig()) {
    console.log('🛑 Por favor configura las variables en .env antes de conectar WhatsApp.\n');
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`📱 Usando WhatsApp v${version.join('.')}, última versión: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: true,
  });

  // Helper para enviar mensajes y registrar su ID
  async function replyMessage(jid, content, options = {}) {
    const sent = await sock.sendMessage(jid, content, options);
    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
      // Limpiar memoria cada tanto
      if (sentMessageIds.size > 1000) {
        const first = sentMessageIds.values().next().value;
        sentMessageIds.delete(first);
      }
    }
    return sent;
  }

  // Guardar credenciales de sesión
  sock.ev.on('creds.update', saveCreds);

  // Manejo de conexión y generación de QR
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(Dispositivos vinculados -> Vincular un dispositivo)\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`⚠️ Conexión cerrada (Motivo: ${statusCode || 'desconocido'}). Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        console.log('❌ Sesión cerrada permanentemente. Borra la carpeta auth_info_baileys y vuelve a iniciar.');
      }
    } else if (connection === 'open') {
      console.log('\n✅ ¡BOT CONECTADO CON ÉXITO A WHATSAPP!');
      console.log('Listo para recibir audios y notas de gastos.\n');
    }
  });

  // Helper para reacciones seguras (evita caídas si WhatsApp no permite reaccionar en chat propio)
  async function safeReact(jid, emoji, key) {
    try {
      await sock.sendMessage(jid, { react: { text: emoji, key } });
    } catch (e) {
      // Reacciones son solo estéticas, ignorar error si falla
    }
  }

  // Manejo de mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // IMPORTANTE: 'notify' = mensaje de otra persona; 'append' = mensaje enviado desde tu propio móvil
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

      const remoteJid = msg.key.remoteJid;
      if (remoteJid.endsWith('@g.us')) continue; // ignorar grupos

      // Obtener identificadores propios del bot
      const myCleanNumber = sock.user?.id ? sock.user.id.split(':')[0].replace(/[^0-9]/g, '') : '';
      const myCleanLid = sock.user?.lid ? sock.user.lid.split(':')[0].replace(/[^0-9]/g, '') : '';

      const senderDigits = remoteJid.replace(/[^0-9]/g, '');
      const isSelfChat = (myCleanNumber && senderDigits.includes(myCleanNumber)) ||
                         (myCleanLid && senderDigits.includes(myCleanLid)) ||
                         remoteJid.includes('s.whatsapp.net') && myCleanNumber && remoteJid.includes(myCleanNumber);

      // Si el bot fue quien envió este mensaje (para responder), ignorarlo para no hacer loop
      if (msg.key.id && sentMessageIds.has(msg.key.id)) continue;

      // Si NO es el chat contigo mismo (Tú):
      if (!isSelfChat) {
        // Si no está explícitamente en la lista blanca de números autorizados, IGNORAR TOTALMENTE
        if (config.allowedNumbers.length === 0 || !config.allowedNumbers.includes(senderDigits)) {
          continue; // No responde, no hace nada, se queda mudo con tus otros chats
        }
      }

      try {
        // Desenvolver mensajes por si vienen en ephemeral / viewOnce
        const actualMessage = msg.message?.ephemeralMessage?.message ||
                              msg.message?.viewOnceMessage?.message ||
                              msg.message?.viewOnceMessageV2?.message ||
                              msg.message;

        let textoRecibido = '';
        let esNotaDeVoz = false;

        // 1. Detectar si es mensaje de texto
        if (actualMessage.conversation) {
          textoRecibido = actualMessage.conversation;
        } else if (actualMessage.extendedTextMessage?.text) {
          textoRecibido = actualMessage.extendedTextMessage.text;
        }

        // 2. Detectar si es nota de voz o audio
        const audioMsg = actualMessage.audioMessage || actualMessage.voiceMessage;
        if (audioMsg) {
          esNotaDeVoz = true;
          console.log(`🎙️ Nota de voz recibida en ${isSelfChat ? 'Chat Contigo Mismo' : '+' + senderDigits}. Descargando y transcribiendo...`);
          
          await safeReact(remoteJid, '⏳', msg.key);

          const audioBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );

          textoRecibido = await transcribirAudio(audioBuffer, audioMsg.mimetype);
          console.log(`📝 Transcripción Whisper: "${textoRecibido}"`);
        }

        if (!textoRecibido || textoRecibido.trim() === '') {
          continue;
        }

        console.log(`💬 Mensaje a procesar: "${textoRecibido}"`);

        await safeReact(remoteJid, '🧠', msg.key);

        // 3. Procesar con Groq Llama / GPT
        const iaResponse = await procesarMensajeConIA(textoRecibido);
        console.log('🤖 Decisión IA:', JSON.stringify(iaResponse));

        // 4. Ejecutar la acción según la intención detectada
        switch (iaResponse.accion) {
          case 'registrar_gastos': {
            if (!iaResponse.gastos || iaResponse.gastos.length === 0) {
              await replyMessage(remoteJid, {
                text: '⚠️ No alcancé a identificar los montos del gasto. ¿Podrías repetirlo más claro?'
              });
              break;
            }

            // Insertar en Supabase (usar senderDigits o myCleanNumber si es self-chat)
            const targetUserPhone = isSelfChat ? myCleanNumber : senderDigits;
            const guardados = await registrarGastos(targetUserPhone, iaResponse.gastos);
            const resumenHoy = await getResumenHoy(targetUserPhone);

            let respuesta = '';
            if (esNotaDeVoz) {
              respuesta += `🎙️ _"${textoRecibido}"_\n\n`;
            }

            respuesta += '✅ *Gasto(s) registrado(s):*\n';
            for (const g of guardados) {
              const icon = getCatIcon(g.categoria);
              respuesta += `• ${icon} *${formatCOP(g.monto)}* — ${g.descripcion} (${g.categoria})\n`;
            }

            respuesta += `\n📊 *Total hoy:* ${formatCOP(resumenHoy.total)} (${resumenHoy.cantidad} gastos)`;

            await replyMessage(remoteJid, { text: respuesta });
            await safeReact(remoteJid, '✅', msg.key);
            break;
          }

          case 'consultar_hoy': {
            const targetUserPhone = isSelfChat ? myCleanNumber : senderDigits;
            const resumen = await getResumenHoy(targetUserPhone);
            let respuesta = `📊 *Resumen de Gastos de Hoy*\n\n`;
            respuesta += `💰 *Total hoy:* ${formatCOP(resumen.total)}\n`;
            respuesta += `🧾 *Cantidad:* ${resumen.cantidad} registro(s)\n`;

            if (resumen.gastos && resumen.gastos.length > 0) {
              respuesta += `\n*Detalle de hoy:*\n`;
              for (const g of resumen.gastos.slice(0, 10)) {
                const icon = getCatIcon(g.categoria);
                respuesta += `• ${icon} ${formatCOP(g.monto)}: ${g.descripcion}\n`;
              }
            } else {
              respuesta += `\n_Hoy todavía no has registrado ningún gasto. ¡Vas invicto!_ ✨`;
            }

            await replyMessage(remoteJid, { text: respuesta });
            await safeReact(remoteJid, '📈', msg.key);
            break;
          }

          case 'consultar_mes': {
            const targetUserPhone = isSelfChat ? myCleanNumber : senderDigits;
            const resumen = await getResumenMes(targetUserPhone);
            let respuesta = `📅 *Resumen de Gastos del Mes*\n\n`;
            respuesta += `💰 *Total acumulado:* ${formatCOP(resumen.total)}\n`;
            respuesta += `🧾 *Total registros:* ${resumen.cantidad}\n`;

            if (resumen.categorias && resumen.categorias.length > 0) {
              respuesta += `\n*Desglose por categorías:*\n`;
              for (const cat of resumen.categorias) {
                const icon = getCatIcon(cat.nombre);
                respuesta += `• ${icon} *${cat.nombre.toUpperCase()}:* ${formatCOP(cat.monto)} (${cat.porcentaje}%)\n`;
              }
            }

            await replyMessage(remoteJid, { text: respuesta });
            await safeReact(remoteJid, '📊', msg.key);
            break;
          }

          case 'eliminar_ultimo': {
            const targetUserPhone = isSelfChat ? myCleanNumber : senderDigits;
            const eliminado = await eliminarUltimoGasto(targetUserPhone);
            if (eliminado) {
              const icon = getCatIcon(eliminado.categoria);
              const respuesta = `🗑️ *Gasto eliminado correctamente:*\n• ${icon} *${formatCOP(eliminado.monto)}* — ${eliminado.descripcion}`;
              await replyMessage(remoteJid, { text: respuesta });
              await safeReact(remoteJid, '🗑️', msg.key);
            } else {
              await replyMessage(remoteJid, {
                text: 'ℹ️ No encontré ningún gasto reciente para eliminar.'
              });
            }
            break;
          }

          case 'ayuda': {
            await replyMessage(remoteJid, { text: iaResponse.mensaje });
            await safeReact(remoteJid, '💡', msg.key);
            break;
          }

          default: {
            await replyMessage(remoteJid, {
              text: iaResponse.mensaje || '🤔 No entendí el mensaje. Puedes enviarme audios o textos como: "15 lucas de almuerzo", o preguntar "¿cuánto gasté hoy?"'
            });
            await safeReact(remoteJid, '❓', msg.key);
            break;
          }
        }
      } catch (err) {
        console.error('❌ Error procesando mensaje:', err);
        await replyMessage(remoteJid, {
          text: '⚠️ Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.'
        });
        await safeReact(remoteJid, '❌', msg.key);
      }
    }
  });
}

// Iniciar
startBot().catch((err) => {
  console.error('Error fatal al iniciar bot:', err);
});
