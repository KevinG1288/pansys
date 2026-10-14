-- =====================================================================================
-- Pansys - Fase 1: trazabilidad de insumos y coherencia de órdenes de producción
-- =====================================================================================
-- Requisitos:
--   * 001_fase0_produccion.sql ya aplicado.
--   * Las tablas orden_produccion e insumo_usado deben estar VACÍAS (ver verificación previa).
--
-- Ejecución:
--   * Manualmente en MySQL Workbench, UNA sola vez, bloque por bloque.
--   * Ejecute primero la verificación previa y continúe solo si todos los resultados
--     coinciden con lo esperado.
--   * Cada ALTER TABLE es atómico (si falla, esa tabla queda como estaba), pero el script
--     completo NO es transaccional: si una sentencia falla, las anteriores ya quedaron
--     aplicadas. Revise la verificación posterior antes de reintentar.
--
-- Significado de las cantidades en insumo_usado (por materia prima y orden):
--   cantidad_usada      = cantidad DESCONTADA del inventario al crear la orden
--                         (se conserva el nombre para no renombrar la columna).
--   cantidad_consumida  = parte convertida en producto (solo al finalizar; 0 si se cancela).
--   cantidad_devuelta   = parte devuelta al inventario al cancelar.
--   cantidad_mermada    = parte perdida al cancelar (descontada - devuelta).
--   Invariante: consumida + devuelta + mermada <= cantidad_usada
--               (= cantidad_usada una vez cerrada la orden; lo garantiza el código).
-- =====================================================================================

USE pansys_db;

-- =====================================================================================
-- 0. VERIFICACIÓN PREVIA (solo lectura)
-- =====================================================================================
-- Esperado: pansys_db
SELECT DATABASE() AS base_actual;

-- Esperado: 0 y 0. Si alguna es mayor que 0, NO continúe.
SELECT
  (SELECT COUNT(*) FROM orden_produccion) AS ordenes,
  (SELECT COUNT(*) FROM insumo_usado)     AS insumos_usados;

-- Esperado: 0 filas (las columnas nuevas todavía no existen).
SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'insumo_usado' AND COLUMN_NAME IN
        ('cantidad_por_unidad', 'unidad_medida', 'precio_unitario',
         'cantidad_consumida', 'cantidad_devuelta', 'cantidad_mermada'))
    OR (TABLE_NAME = 'orden_produccion' AND COLUMN_NAME = 'cerrado_por'));

-- Esperado: solo restricciones de la fase 0 (chk_insumo_cantidad, chk_orden_planificada,
-- chk_orden_producida, fk_*, uq_insumo_orden, PRIMARY, idx...).
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('insumo_usado', 'orden_produccion')
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- =====================================================================================
-- 1. insumo_usado: copia histórica y desglose de cantidades
-- =====================================================================================
-- La copia (cantidad por unidad, unidad y precio) se toma al crear la orden, para que
-- modificar o eliminar la receta o la materia prima no altere órdenes existentes.
ALTER TABLE insumo_usado
  ADD COLUMN cantidad_por_unidad DECIMAL(12,4) NOT NULL
    COMMENT 'Copia de la receta al crear la orden'
    AFTER materia_prima_id,
  ADD COLUMN unidad_medida VARCHAR(255) NOT NULL
    COMMENT 'Copia de materia_prima.unidad_medida al crear la orden'
    AFTER cantidad_por_unidad,
  ADD COLUMN precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0
    COMMENT 'Copia de materia_prima.precio_unitario al crear la orden'
    AFTER unidad_medida,
  ADD COLUMN cantidad_consumida DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT 'Convertida en producto (solo al finalizar)'
    AFTER cantidad_usada,
  ADD COLUMN cantidad_devuelta DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT 'Devuelta al inventario al cancelar'
    AFTER cantidad_consumida,
  ADD COLUMN cantidad_mermada DECIMAL(12,4) NOT NULL DEFAULT 0
    COMMENT 'Perdida al cancelar (descontada - devuelta)'
    AFTER cantidad_devuelta,
  ADD CONSTRAINT chk_insumo_copia_valida
    CHECK (cantidad_por_unidad > 0 AND precio_unitario >= 0 AND costo >= 0),
  ADD CONSTRAINT chk_insumo_no_negativos
    CHECK (cantidad_consumida >= 0 AND cantidad_devuelta >= 0 AND cantidad_mermada >= 0),
  ADD CONSTRAINT chk_insumo_no_excede
    CHECK (cantidad_consumida + cantidad_devuelta + cantidad_mermada <= cantidad_usada);

-- Documentar en el propio esquema que cantidad_usada es la cantidad descontada.
-- Va en una sentencia aparte: si fallara, no afecta al bloque anterior.
ALTER TABLE insumo_usado
  MODIFY COLUMN cantidad_usada DECIMAL(12,4) NOT NULL
    COMMENT 'Cantidad DESCONTADA del inventario al crear la orden';

-- =====================================================================================
-- 2. orden_produccion: quién cierra la orden y coherencia de estados
-- =====================================================================================
-- cerrado_por no se usa en ningún CHECK (MySQL no permite CHECK sobre columnas con
-- acciones referenciales); su coherencia la garantiza el código.
-- fecha_finalizacion guarda la fecha de cierre (finalización o cancelación).
ALTER TABLE orden_produccion
  ADD COLUMN cerrado_por INT NULL
    COMMENT 'Usuario que finalizó o canceló la orden'
    AFTER fecha_finalizacion,
  ADD CONSTRAINT fk_orden_cerrado_por FOREIGN KEY (cerrado_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT chk_orden_producida_max
    CHECK (cantidad_producida IS NULL OR cantidad_producida <= cantidad_planificada),
  ADD CONSTRAINT chk_orden_estado_coherente
    CHECK (
      (estado = 'en_proceso'
        AND cantidad_producida IS NULL AND fecha_finalizacion IS NULL
        AND motivo_cancelacion IS NULL AND insumos_devueltos = 0)
      OR (estado = 'finalizada'
        AND cantidad_producida IS NOT NULL AND fecha_finalizacion IS NOT NULL
        AND motivo_cancelacion IS NULL AND insumos_devueltos = 0)
      OR (estado = 'cancelada'
        AND cantidad_producida IS NULL AND fecha_finalizacion IS NOT NULL
        AND motivo_cancelacion IS NOT NULL)
    );

-- =====================================================================================
-- 3. VERIFICACIÓN POSTERIOR (solo lectura)
-- =====================================================================================
-- Esperado: 6 filas en insumo_usado + 1 en orden_produccion.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'insumo_usado' AND COLUMN_NAME IN
        ('cantidad_por_unidad', 'unidad_medida', 'precio_unitario', 'cantidad_usada',
         'cantidad_consumida', 'cantidad_devuelta', 'cantidad_mermada'))
    OR (TABLE_NAME = 'orden_produccion' AND COLUMN_NAME = 'cerrado_por'))
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Esperado: chk_insumo_cantidad, chk_insumo_copia_valida, chk_insumo_no_negativos,
-- chk_insumo_no_excede, chk_orden_planificada, chk_orden_producida,
-- chk_orden_producida_max, chk_orden_estado_coherente.
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc
  ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
  AND tc.TABLE_NAME IN ('insumo_usado', 'orden_produccion')
ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;

-- Esperado: fk_orden_cerrado_por -> usuarios.id (RESTRICT / CASCADE).
SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
       r.DELETE_RULE, r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'orden_produccion'
  AND k.COLUMN_NAME = 'cerrado_por';

-- Esperado: 0 y 0 (el script no inserta datos).
SELECT
  (SELECT COUNT(*) FROM orden_produccion) AS ordenes,
  (SELECT COUNT(*) FROM insumo_usado)     AS insumos_usados;

-- =====================================================================================
-- 4. REVERSIÓN (solo si fuera necesario; está comentada a propósito)
-- =====================================================================================
-- ADVERTENCIAS:
--   * DDL en MySQL hace COMMIT implícito: no hay ROLLBACK posible.
--   * Si ya existen órdenes, eliminar estas columnas BORRA DE FORMA IRRECUPERABLE la
--     copia histórica (cantidad por unidad, unidad, precio), el desglose de cantidades
--     consumidas/devueltas/mermadas y el usuario que cerró cada orden. Haga una copia de
--     seguridad antes (Server > Data Export en Workbench).
--   * La reversión NO devuelve existencias a materia_prima ni a productos: los movimientos
--     de inventario hechos por órdenes ya procesadas permanecen.
--   * Si la aplicación de la fase 1 ya está desplegada, revertir el esquema la romperá:
--     revierta también el código.
--   * Si el script se aplicó parcialmente, ejecute solo las sentencias cuyo objeto exista
--     (compruébelo con la verificación posterior). El orden importa: primero CHECK y FK,
--     luego índices y columnas.
--
-- ALTER TABLE orden_produccion
--   DROP CHECK chk_orden_estado_coherente,
--   DROP CHECK chk_orden_producida_max,
--   DROP FOREIGN KEY fk_orden_cerrado_por;
-- ALTER TABLE orden_produccion
--   DROP INDEX fk_orden_cerrado_por,
--   DROP COLUMN cerrado_por;
--
-- ALTER TABLE insumo_usado
--   DROP CHECK chk_insumo_no_excede,
--   DROP CHECK chk_insumo_no_negativos,
--   DROP CHECK chk_insumo_copia_valida;
-- ALTER TABLE insumo_usado
--   DROP COLUMN cantidad_mermada,
--   DROP COLUMN cantidad_devuelta,
--   DROP COLUMN cantidad_consumida,
--   DROP COLUMN precio_unitario,
--   DROP COLUMN unidad_medida,
--   DROP COLUMN cantidad_por_unidad,
--   MODIFY COLUMN cantidad_usada DECIMAL(12,4) NOT NULL;
