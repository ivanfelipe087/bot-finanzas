import { config, validateConfig } from './src/config.js';
import { procesarMensajeConIA } from './src/services/groq.js';

const frasesPrueba = [
  'Mano, me gasté 4 lucas en unas empanadas y 3 mil de pasaje en metrolínea',
  'Pagué 55k de la factura de internet y 12 lucas de un almuerzo en la UTS',
  'Gasté medio palo en una chaqueta',
  '¿cuánto he gastado hoy mano?',
  'dame el resumen del mes',
  'borra el último gasto que me equivoqué',
  'hola buenas tardes cómo funciona este bot?'
];

async function runTests() {
  console.log('==================================================');
  console.log('🧪 PROBANDO EL MOTOR DE IA CON GROQ (LLAMA 3.3)');
  console.log('==================================================\n');

  if (!config.groqApiKey || config.groqApiKey === 'tu_groq_api_key_aqui') {
    console.error('❌ Falta configurar GROQ_API_KEY en el archivo bot-finanzas/.env');
    console.log('👉 Entra a https://console.groq.com/keys, genera una clave gratuita y pégala en .env\n');
    return;
  }

  for (const frase of frasesPrueba) {
    console.log(`\n💬 Entrada: "${frase}"`);
    try {
      const inicio = Date.now();
      const resultado = await procesarMensajeConIA(frase);
      const tiempo = Date.now() - inicio;
      console.log(`⚡ Procesado en ${tiempo}ms:`);
      console.dir(resultado, { depth: null, colors: true });
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  }

  console.log('\n==================================================');
  console.log('🏁 Pruebas finalizadas.');
  console.log('==================================================\n');
}

runTests();
