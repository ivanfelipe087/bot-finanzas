-- ==============================================================================
-- SCHEMA SUPABASE: BOT DE FINANZAS PERSONALES POR WHATSAPP
-- ==============================================================================

-- 1. Tabla de Gastos
CREATE TABLE IF NOT EXISTS public.gastos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone TEXT NOT NULL,                  -- Número de WhatsApp (ej: "573001234567")
    monto NUMERIC(12, 2) NOT NULL,             -- Valor en COP (ej: 15000.00)
    categoria TEXT NOT NULL DEFAULT 'otros',  -- comida, transporte, servicios, ocio, salud, etc.
    descripcion TEXT,                         -- "almuerzo en la UTS", "pasaje metrolínea"
    fecha DATE NOT NULL DEFAULT CURRENT_DATE, -- Fecha del gasto para agrupaciones
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas rápidas por usuario y fecha
CREATE INDEX IF NOT EXISTS idx_gastos_user_fecha ON public.gastos (user_phone, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_user_categoria ON public.gastos (user_phone, categoria);

-- Desactivar Row Level Security (RLS) para permitir que el bot inserte y consulte libremente
ALTER TABLE public.gastos DISABLE ROW LEVEL SECURITY;

-- 2. Función para obtener el resumen de hoy de un usuario
CREATE OR REPLACE FUNCTION get_resumen_hoy(p_user_phone TEXT)
RETURNS TABLE (
    total_hoy NUMERIC,
    cantidad_gastos BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(monto), 0) AS total_hoy,
        COUNT(*) AS cantidad_gastos
    FROM public.gastos
    WHERE user_phone = p_user_phone
      AND fecha = CURRENT_DATE;
END;
$$;

-- 3. Función para obtener el resumen del mes actual
CREATE OR REPLACE FUNCTION get_resumen_mes(p_user_phone TEXT)
RETURNS TABLE (
    total_mes NUMERIC,
    cantidad_gastos BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(monto), 0) AS total_mes,
        COUNT(*) AS cantidad_gastos
    FROM public.gastos
    WHERE user_phone = p_user_phone
      AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE);
END;
$$;

-- 4. Función para obtener desglose por categorías del mes actual
CREATE OR REPLACE FUNCTION get_categorias_mes(p_user_phone TEXT)
RETURNS TABLE (
    categoria TEXT,
    total NUMERIC,
    porcentaje NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
    v_total_mes NUMERIC;
BEGIN
    -- Obtenemos el total global del mes para calcular porcentajes
    SELECT COALESCE(SUM(monto), 0) INTO v_total_mes
    FROM public.gastos
    WHERE user_phone = p_user_phone
      AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE);

    IF v_total_mes = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        g.categoria,
        SUM(g.monto) AS total,
        ROUND((SUM(g.monto) / v_total_mes) * 100, 1) AS porcentaje
    FROM public.gastos g
    WHERE g.user_phone = p_user_phone
      AND date_trunc('month', g.fecha) = date_trunc('month', CURRENT_DATE)
    GROUP BY g.categoria
    ORDER BY total DESC;
END;
$$;
