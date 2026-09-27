import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabase = null;

export function getSupabaseClient() {
  if (!supabase) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Supabase no está configurado. Revisa tu archivo .env');
    }
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
  }
  return supabase;
}

/**
 * Inserta uno o varios gastos en la base de datos
 */
export async function registrarGastos(userPhone, listaGastos) {
  const client = getSupabaseClient();
  const registros = listaGastos.map(g => ({
    user_phone: userPhone,
    monto: Number(g.monto),
    categoria: g.categoria?.toLowerCase() || 'otros',
    descripcion: g.descripcion || 'Sin descripción',
    fecha: new Date().toISOString().split('T')[0],
  }));

  const { data, error } = await client
    .from('gastos')
    .insert(registros)
    .select();

  if (error) {
    console.error('Error insertando en Supabase:', error);
    throw error;
  }

  return data;
}

/**
 * Obtiene el resumen total de gastos del día de hoy
 */
export async function getResumenHoy(userPhone) {
  const client = getSupabaseClient();
  const hoy = new Date().toISOString().split('T')[0];

  const { data, error } = await client
    .from('gastos')
    .select('monto, categoria, descripcion, created_at')
    .eq('user_phone', userPhone)
    .eq('fecha', hoy)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error consultando resumen de hoy:', error);
    throw error;
  }

  const total = (data || []).reduce((acc, curr) => acc + Number(curr.monto), 0);
  return {
    total,
    cantidad: data.length,
    gastos: data,
  };
}

/**
 * Obtiene el resumen del mes actual y desglose por categorías
 */
export async function getResumenMes(userPhone) {
  const client = getSupabaseClient();
  const fechaInicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data, error } = await client
    .from('gastos')
    .select('monto, categoria')
    .eq('user_phone', userPhone)
    .gte('fecha', fechaInicioMes);

  if (error) {
    console.error('Error consultando resumen del mes:', error);
    throw error;
  }

  const total = (data || []).reduce((acc, curr) => acc + Number(curr.monto), 0);
  
  // Agrupar por categoría
  const categoriasMap = {};
  for (const item of (data || [])) {
    const cat = item.categoria || 'otros';
    categoriasMap[cat] = (categoriasMap[cat] || 0) + Number(item.monto);
  }

  const categorias = Object.entries(categoriasMap)
    .map(([nombre, monto]) => ({
      nombre,
      monto,
      porcentaje: total > 0 ? Math.round((monto / total) * 100) : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  return {
    total,
    cantidad: (data || []).length,
    categorias,
  };
}

/**
 * Elimina el último gasto registrado por el usuario
 */
export async function eliminarUltimoGasto(userPhone) {
  const client = getSupabaseClient();

  // 1. Buscar el último gasto
  const { data: ultimos, error: searchError } = await client
    .from('gastos')
    .select('id, monto, categoria, descripcion')
    .eq('user_phone', userPhone)
    .order('created_at', { ascending: false })
    .limit(1);

  if (searchError || !ultimos || ultimos.length === 0) {
    return null;
  }

  const ultimo = ultimos[0];

  // 2. Eliminarlo por ID
  const { error: deleteError } = await client
    .from('gastos')
    .delete()
    .eq('id', ultimo.id);

  if (deleteError) {
    console.error('Error al eliminar último gasto:', deleteError);
    throw deleteError;
  }

  return ultimo;
}
