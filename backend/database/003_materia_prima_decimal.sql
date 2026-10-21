-- =====================================================================================
-- Pansys - 003: materia_prima a DECIMAL(12,4) (cantidades y precio exactos)
-- =====================================================================================
-- TIPO: registro histórico de una migración de producción ya aplicada (y migración para una
--   pansys_db que aún no la tenga).
--
-- ESTADO: YA APLICADO MANUALMENTE en pansys_db (confirmado con SHOW CREATE TABLE).
--   NO lo vuelva a ejecutar sobre pansys_db. Este archivo registra el cambio en el
--   repositorio y sirve para aplicarlo a una base creada solo con 001 y 002.
--   pansys_test se alineó con backend/database/pruebas/003_materia_prima_decimal_pansys_test.sql,
--   y crear_pansys_test.sql ya crea estas columnas con la definición nueva.
--
-- Definición resultante (la que tiene hoy pansys_db):
--   `cantidad_disponible` decimal(12,4) NOT NULL DEFAULT '0.0000',
--   `stock_minimo`        decimal(12,4) NOT NULL DEFAULT '0.0000',
--   `precio_unitario`     decimal(12,4) NOT NULL DEFAULT '0.0000',
-- Definición anterior (tras 001 y 002): las tres `float DEFAULT '0'`, admitiendo NULL.
--
-- Requisitos: 001 y 002 aplicados; MySQL 8. Independiente de 004.
-- El código (modelo MateriaPrima, Inventario, Recetas y Producción) asume esta definición:
-- aplique el SQL ANTES de desplegar ese código.
--
-- Ejecución (solo sobre una base que aún no lo tenga):
--   * Manualmente en MySQL Workbench, bloque por bloque.
--   * Si la verificación 1.2 muestra decimal(12,4), el cambio YA ESTÁ APLICADO: deténgase.
--   * El ALTER es una única sentencia DDL atómica: se aplican las tres columnas o ninguna.
--     Hace COMMIT implícito: no hay ROLLBACK posible (ver la reversión al final).
--   * Para una comparación fila por fila antes/después, use el procedimiento del archivo de
--     pruebas (tabla temporal y clasificación de valores FLOAT).
-- =====================================================================================

-- Como 001 y 002, apunta a pansys_db (p. ej. una instalación nueva o restaurada desde una copia
-- anterior al cambio). En la pansys_db actual, el paso 1.2 muestra decimal(12,4): DETÉNGASE ahí.
USE pansys_db;

-- =====================================================================================
-- 1. VERIFICACIÓN PREVIA (solo lectura)
-- =====================================================================================

-- 1.1 Esperado: la base sobre la que quiere aplicar el cambio
SELECT DATABASE() AS base_actual;

-- 1.2 Esperado: float | YES | 0 en las tres. Si aparece decimal(12,4), YA está aplicado: DETÉNGASE.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materia_prima'
  AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
ORDER BY ORDINAL_POSITION;

-- 1.3 Esperado: *_null = 0 y fuera_de_rango = 0 (si no, el ALTER fallaría sin cambiar nada).
--     Los negativos son informativos (DECIMAL(12,4) los admite; Inventario ya los rechaza).
SELECT COUNT(*) AS filas,
       SUM(cantidad_disponible IS NULL) AS disp_null,
       SUM(stock_minimo IS NULL)        AS min_null,
       SUM(precio_unitario IS NULL)     AS precio_null,
       SUM(cantidad_disponible < 0 OR stock_minimo < 0 OR precio_unitario < 0) AS con_negativos,
       SUM(ABS(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4)) > 99999999.9999
        OR ABS(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4)) > 99999999.9999
        OR ABS(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4)) > 99999999.9999) AS fuera_de_rango
FROM materia_prima;

-- 1.4 Valores que CAMBIARÍAN de forma visible: el valor redondeado a 4 decimales no coincide
--     con el que MySQL muestra hoy (más de 4 decimales reales, o error binario de FLOAT que
--     alcanza el 4.º decimal, p. ej. 25000.1 -> 25000.0996). Esperado: ninguna fila.
--     Las diferencias solo binarias (0.300000011920929 -> 0.3000) no aparecen: no cambian lo que se ve.
SELECT id, nombre,
       CAST(cantidad_disponible AS CHAR) AS disp_mostrado, ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) AS disp_resultado,
       CAST(stock_minimo        AS CHAR) AS min_mostrado,  ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) AS min_resultado,
       CAST(precio_unitario     AS CHAR) AS precio_mostrado, ROUND(CAST(precio_unitario   AS DECIMAL(65,20)), 4) AS precio_resultado
FROM materia_prima
WHERE ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) <> CAST(CAST(cantidad_disponible AS CHAR) AS DECIMAL(65,20))
   OR ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) <> CAST(CAST(stock_minimo        AS CHAR) AS DECIMAL(65,20))
   OR ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4) <> CAST(CAST(precio_unitario     AS CHAR) AS DECIMAL(65,20))
ORDER BY id;

-- 1.5 Huella para comparar después (valores normalizados a 4 decimales). ANÓTELA.
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, nombre, unidad_medida,
         COALESCE(CAST(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         panaderia_id, COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM materia_prima;

-- =====================================================================================
-- 2. CAMBIO
-- =====================================================================================
-- Cambiar de FLOAT a DECIMAL exige copiar la tabla (ALGORITHM = COPY).
ALTER TABLE materia_prima
  MODIFY COLUMN cantidad_disponible DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  MODIFY COLUMN stock_minimo        DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  MODIFY COLUMN precio_unitario     DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  ALGORITHM = COPY;

-- =====================================================================================
-- 3. VERIFICACIÓN POSTERIOR (solo lectura)
-- =====================================================================================

-- 3.1 Esperado: decimal(12,4) | NO | 0.0000 en las tres columnas
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materia_prima'
  AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
ORDER BY ORDINAL_POSITION;

-- 3.2 Esperado: filas y huella IDÉNTICAS a las de 1.5
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, nombre, unidad_medida,
         COALESCE(CAST(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         panaderia_id, COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM materia_prima;

-- 3.3 Definición completa
SHOW CREATE TABLE materia_prima;

-- =====================================================================================
-- 4. REVERSIÓN (solo si fuera necesario; comentada a propósito)
-- =====================================================================================
-- ADVERTENCIAS:
--   * Revierta PRIMERO el código que asume DECIMAL (modelo MateriaPrima, validación de
--     Inventario y cálculos de Recetas y Producción).
--   * PUEDE PERDER PRECISIÓN: FLOAT guarda unos 7 dígitos significativos y valores
--     aproximados (25000.1 -> 25000.099609375; 1234567.8912 -> 1234567.875).
--   * DDL: COMMIT implícito, sin ROLLBACK. Haga antes una copia de seguridad
--     (Server > Data Export en Workbench).
--
-- ALTER TABLE materia_prima
--   MODIFY COLUMN cantidad_disponible FLOAT NULL DEFAULT '0',
--   MODIFY COLUMN stock_minimo        FLOAT NULL DEFAULT '0',
--   MODIFY COLUMN precio_unitario     FLOAT NULL DEFAULT '0',
--   ALGORITHM = COPY;
