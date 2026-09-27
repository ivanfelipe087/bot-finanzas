import { Bot, InlineKeyboard } from 'grammy';
import http from 'http';
import { config } from './config.js';
import { transcribirAudio, procesarMensajeConIA } from './services/groq.js';
import {
  registrarGastos,
  getResumenHoy,
  getResumenMes,
  eliminarUltimoGasto,
} from './services/supabase.js';

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

async function startTelegramBot() {
  console.log('\n=============================================');
  console.log('🤖 INICIANDO BOT DE FINANZAS EN TELEGRAM');
  console.log('=============================================\n');

  if (!config.telegramBotToken || config.telegramBotToken.includes('tu_token_aqui')) {
    console.error('❌ Falta TELEGRAM_BOT_TOKEN en el archivo .env');
    console.log('👉 Obtén tu token gratis hablando con @BotFather en Telegram.\n');
    process.exit(1);
  }

  const bot = new Bot(config.telegramBotToken);

  // Teclado interactivo con botones rápidos
  const mainKeyboard = new InlineKeyboard()
    .text('📊 Gastos de Hoy', 'cmd_hoy')
    .text('📅 Resumen del Mes', 'cmd_mes')
    .row()
    .text('🗑️ Borrar Último', 'cmd_borrar')
    .text('💡 Ayuda', 'cmd_ayuda');

  // Middleware de Seguridad: Restringir acceso solo a tu ID
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    // Si está configurado el ID en .env, bloquear a cualquier otro
    if (config.telegramUserId && config.telegramUserId.trim() !== '') {
      if (userId !== config.telegramUserId.trim()) {
        console.log(`🚫 Mensaje ignorado de usuario no autorizado: ${userId} (@${ctx.from.username || 'anon'})`);
        return; // Mudo para el resto del mundo
      }
    } else {
      // Si no lo ha configurado, mostrarle su ID para que lo copie
      console.log(`ℹ️ Usuario conectado con Telegram ID: ${userId}`);
    }

    await next();
  });

  // Comando /start o /ayuda
  bot.command(['start', 'ayuda'], async (ctx) => {
    const userId = ctx.from.id.toString();
    let msg = `¡Hola, ${ctx.from.first_name || 'mano'}! 👋\n\n`;
    msg += `Soy tu **asistente personal de finanzas con IA**.\n\n`;
    msg += `🎙️ **Mándame una nota de voz** o escribe tus gastos con lenguaje cotidiano:\n`;
    msg += `• _"15 lucas de almuerzo y 3 mil de pasaje"_\n`;
    msg += `• _"Pagué 55k de internet"_\n`;
    msg += `• _"Medio palo en una chaqueta"_\n\n`;

    if (!config.telegramUserId) {
      msg += `⚠️ **Configuración de seguridad:**\nTu Telegram ID es: \`${userId}\`\n`;
      msg += `Pégalo en tu archivo \`.env\` como \`TELEGRAM_USER_ID=${userId}\` para que el bot sea 100% privado.\n\n`;
    }

    msg += `También puedes usar los botones rápidos de abajo:`;

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      reply_markup: mainKeyboard,
    });
  });

  // Comandos directos de texto
  bot.command('hoy', async (ctx) => handleConsultarHoy(ctx));
  bot.command('mes', async (ctx) => handleConsultarMes(ctx));
  bot.command('borrar', async (ctx) => handleEliminarUltimo(ctx));

  // Manejo de botones interactivos
  bot.callbackQuery('cmd_hoy', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleConsultarHoy(ctx);
  });
  bot.callbackQuery('cmd_mes', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleConsultarMes(ctx);
  });
  bot.callbackQuery('cmd_borrar', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleEliminarUltimo(ctx);
  });
  bot.callbackQuery('cmd_ayuda', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '💡 Puedes enviarme cualquier nota de voz o mensaje diciendo tus consumos diarios. Los clasificaré y sumaré automáticamente en tu base de datos.',
      { reply_markup: mainKeyboard }
    );
  });

  // Manejo de Notas de Voz
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from.id.toString();
    try {
      await ctx.replyWithChatAction('typing');

      // 1. Obtener la URL de descarga del archivo de voz
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

      console.log(`🎙️ Nota de voz de Telegram recibida. Descargando audio...`);
      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // 2. Transcribir con Groq Whisper
      const textoTranscrito = await transcribirAudio(audioBuffer, 'audio/ogg');
      console.log(`📝 Whisper transcribió: "${textoTranscrito}"`);

      if (!textoTranscrito || textoTranscrito.trim() === '') {
        await ctx.reply('⚠️ No alcancé a escuchar bien el audio. ¿Podrías repetirlo?');
        return;
      }

      // 3. Procesar y guardar
      await procesarTextoYEjecutar(ctx, textoTranscrito, userId, true);
    } catch (err) {
      console.error('❌ Error procesando nota de voz en Telegram:', err);
      await ctx.reply('⚠️ Ocurrió un error al transcribir la nota de voz. Por favor intenta de nuevo.');
    }
  });

  // Manejo de Mensajes de Texto
  bot.on('message:text', async (ctx) => {
    const texto = ctx.message.text;
    if (texto.startsWith('/')) return; // Ignorar comandos ya manejados

    const userId = ctx.from.id.toString();
    await procesarTextoYEjecutar(ctx, texto, userId, false);
  });

  // Lógica central: IA + Base de datos
  async function procesarTextoYEjecutar(ctx, texto, userId, esVoz) {
    try {
      await ctx.replyWithChatAction('typing');

      const iaResponse = await procesarMensajeConIA(texto);
      console.log('🤖 Decisión IA Telegram:', JSON.stringify(iaResponse));

      switch (iaResponse.accion) {
        case 'registrar_gastos': {
          if (!iaResponse.gastos || iaResponse.gastos.length === 0) {
            await ctx.reply('⚠️ No identifiqué ningún monto específico. Intenta diciendo por ejemplo: "15 lucas de almuerzo".');
            return;
          }

          // Guardar en Supabase bajo el ID del usuario
          const guardados = await registrarGastos(userId, iaResponse.gastos);
          const resumenHoy = await getResumenHoy(userId);

          let respuesta = '';
          if (esVoz) {
            respuesta += `🎙️ _"${texto}"_\n\n`;
          }

          respuesta += '✅ *Gasto(s) registrado(s):*\n';
          for (const g of guardados) {
            const icon = getCatIcon(g.categoria);
            respuesta += `• ${icon} *${formatCOP(g.monto)}* — ${g.descripcion} _(${g.categoria})_\n`;
          }

          respuesta += `\n📊 *Total hoy:* *${formatCOP(resumenHoy.total)}* (${resumenHoy.cantidad} gastos)`;

          await ctx.reply(respuesta, {
            parse_mode: 'Markdown',
            reply_markup: mainKeyboard,
          });
          break;
        }

        case 'consultar_hoy':
          await handleConsultarHoy(ctx);
          break;

        case 'consultar_mes':
          await handleConsultarMes(ctx);
          break;

        case 'eliminar_ultimo':
          await handleEliminarUltimo(ctx);
          break;

        case 'ayuda':
          await ctx.reply(iaResponse.mensaje || 'Envíame tus gastos en texto o audio.', {
            reply_markup: mainKeyboard,
          });
          break;

        default:
          await ctx.reply(
            iaResponse.mensaje || '🤔 No entendí el mensaje. Prueba diciendo: "12 lucas de almuerzo" o pulsa los botones de abajo.',
            { reply_markup: mainKeyboard }
          );
          break;
      }
    } catch (err) {
      console.error('❌ Error procesando mensaje en Telegram:', err);
      await ctx.reply('⚠️ Ocurrió un error al procesar tu solicitud. Intenta de nuevo.');
    }
  }

  // Métodos auxiliares de consulta
  async function handleConsultarHoy(ctx) {
    const userId = ctx.from.id.toString();
    try {
      const resumen = await getResumenHoy(userId);
      let respuesta = `📊 *Resumen de Hoy*\n\n`;
      respuesta += `💰 *Total hoy:* *${formatCOP(resumen.total)}*\n`;
      respuesta += `🧾 *Cantidad:* ${resumen.cantidad} registro(s)\n`;

      if (resumen.gastos && resumen.gastos.length > 0) {
        respuesta += `\n*Detalle de hoy:*\n`;
        for (const g of resumen.gastos.slice(0, 10)) {
          const icon = getCatIcon(g.categoria);
          respuesta += `• ${icon} ${formatCOP(g.monto)}: ${g.descripcion}\n`;
        }
      } else {
        respuesta += `\n_Hoy no tienes gastos registrados. ¡Vas invicto!_ ✨`;
      }

      await ctx.reply(respuesta, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard,
      });
    } catch (e) {
      console.error(e);
      await ctx.reply('⚠️ Error al consultar el balance de hoy.');
    }
  }

  async function handleConsultarMes(ctx) {
    const userId = ctx.from.id.toString();
    try {
      const resumen = await getResumenMes(userId);
      let respuesta = `📅 *Resumen de este Mes*\n\n`;
      respuesta += `💰 *Total acumulado:* *${formatCOP(resumen.total)}*\n`;
      respuesta += `🧾 *Total registros:* ${resumen.cantidad}\n`;

      if (resumen.categorias && resumen.categorias.length > 0) {
        respuesta += `\n*Desglose por categorías:*\n`;
        for (const cat of resumen.categorias) {
          const icon = getCatIcon(cat.nombre);
          respuesta += `• ${icon} *${cat.nombre.toUpperCase()}:* ${formatCOP(cat.monto)} _(${cat.porcentaje}%)_\n`;
        }
      }

      await ctx.reply(respuesta, {
        parse_mode: 'Markdown',
        reply_markup: mainKeyboard,
      });
    } catch (e) {
      console.error(e);
      await ctx.reply('⚠️ Error al consultar el resumen del mes.');
    }
  }

  async function handleEliminarUltimo(ctx) {
    const userId = ctx.from.id.toString();
    try {
      const eliminado = await eliminarUltimoGasto(userId);
      if (eliminado) {
        const icon = getCatIcon(eliminado.categoria);
        const respuesta = `🗑️ *Gasto eliminado:*\n• ${icon} *${formatCOP(eliminado.monto)}* — ${eliminado.descripcion}`;
        await ctx.reply(respuesta, {
          parse_mode: 'Markdown',
          reply_markup: mainKeyboard,
        });
      } else {
        await ctx.reply('ℹ️ No encontré ningún gasto reciente para eliminar.', {
          reply_markup: mainKeyboard,
        });
      }
    } catch (e) {
      console.error(e);
      await ctx.reply('⚠️ Error al intentar eliminar el último gasto.');
    }
  }

  // Manejo de errores globales
  bot.catch((err) => {
    console.error('Error fatal en bot de Telegram:', err);
  });

  // Servidor HTTP ligero para Render/Koyeb (Health-check que mantiene vivo el servicio)
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'Telegram Finanzas IA Bot',
      uptime: Math.round(process.uptime()) + 's',
      timestamp: new Date().toISOString()
    }));
  });

  server.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP activo en el puerto ${PORT} (listo para Render / Koyeb)`);
  });

  // Iniciar bot
  await bot.start({
    onStart(botInfo) {
      console.log(`✅ ¡BOT DE TELEGRAM ACTIVO Y EN LÍNEA!`);
      console.log(`🤖 Nombre: @${botInfo.username}`);
      console.log('Listo para recibir mensajes y notas de voz.\n');
    },
  });
}

startTelegramBot().catch(console.error);
