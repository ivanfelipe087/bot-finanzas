# 🤖 Bot de Finanzas Personales por WhatsApp (100% Gratis)

Bot inteligente para registrar y consultar finanzas personales por **notas de voz y mensajes de texto** en WhatsApp, adaptado a la jerga colombiana ("lucas", "k", "palos").

Construido con **Baileys**, **Groq (Whisper + Llama 3.3 70B)** y **Supabase**.

---

## 🚀 ¿Cómo funciona?

1. **Mandas un audio o texto:** *"Mano, me gasté 4 lucas en unas empanadas y 3 mil de pasaje"*.
2. **Groq Whisper:** Transcribe la nota de voz en menos de 1 segundo.
3. **Groq Llama 3.3 70B:** Extrae los montos, descripciones y clasifica por categorías en JSON estructurado.
4. **Supabase:** Almacena los registros en PostgreSQL.
5. **WhatsApp:** El bot te responde confirmando el gasto y mostrando tu acumulado del día.

---

## 📦 Configuración Inicial (5 Minutos)

### 1. Claves gratuitas necesarias

1. **Groq API:**
   - Ve a [console.groq.com/keys](https://console.groq.com/keys).
   - Crea una API Key (es 100% gratis).
2. **Supabase:**
   - Crea un proyecto gratuito en [supabase.com](https://supabase.com).
   - Ve al **SQL Editor** y ejecuta el script [supabase_setup.sql](./supabase_setup.sql).
   - Ve a **Project Settings -> API** y copia la `URL` y la `anon key` (o `service_role key`).

### 2. Archivo `.env`

Copia el archivo `.env.example` como `.env`:

```bash
cp .env.example .env
```

Y reemplaza con tus credenciales:

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOi...

# (Opcional) Tu número con código 57 si quieres restringirlo solo para ti:
ALLOWED_NUMBERS=573001234567
```

---

## 🧪 3. Probar solo la IA (sin WhatsApp aún)

Puedes comprobar que el motor de IA entiende expresiones colombianas ejecutando:

```bash
node test_ia.js
```

---

## 📲 4. Iniciar el Bot con WhatsApp

Para vincular el bot con tu cuenta:

```bash
npm start
```

1. Se generará un **código QR en la terminal**.
2. Abre WhatsApp en tu celular -> **Dispositivos vinculados -> Vincular un dispositivo**.
3. Escanea el QR.
4. ¡Listo! Escríbele o mándale notas de voz.

---

## 💬 Comandos y Ejemplos de Uso

| Acción | Lo que le dices (texto o voz) | Respuesta del bot |
| :--- | :--- | :--- |
| **Registrar gasto simple** | *"15 mil de almuerzo"* | Registra \$15.000 en Comida y suma al día. |
| **Múltiples gastos** | *"Pagué 55k de internet y 12 lucas de taxi"* | Separa y guarda 2 registros automáticamente. |
| **Jerga colombiana** | *"Gasté 4 lucas en empanadas"* | Entiende que son \$4.000 COP. |
| **Consultar hoy** | *"¿Cuánto he gastado hoy mano?"* | Muestra total gastado hoy y lista de consumos. |
| **Resumen del mes** | *"Resumen del mes"* | Muestra total del mes y desglose con porcentajes por categoría. |
| **Corregir error** | *"Borra el último gasto"* | Elimina de la base de datos el último registro que hiciste. |
