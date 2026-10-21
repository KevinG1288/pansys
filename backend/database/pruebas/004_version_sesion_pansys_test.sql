-- =====================================================================================
-- Pansys - 004 (base de PRUEBAS): versión de sesión para invalidar los JWT anteriores
-- =====================================================================================
-- Mismo cambio que backend/database/004_version_sesion.sql, pero SOLO sobre pansys_test:
-- añade usuarios.version_sesion INT UNSIGNED NOT NULL DEFAULT 0. Todas las sentencias que
-- modifican algo nombran explícitamente pansys_test; pansys_db solo se LEE (paso 3.5).
--
-- TIPO: migración de una base de PRUEBAS existente (y registro de lo aplicado en pansys_test).
--
-- ESTADO: YA APLICADO en pansys_test el 2026-10-20, con todas las verificaciones correctas.
--   NO LO VUELVA A EJECUTAR sobre pansys_test: el paso 1.2 mostraría columna_existe = 1
--   (DETÉNGASE ahí) y el ALTER fallaría con el error 1060 (columna duplicada) sin cambiar nada.
--   Para crear una base de pruebas NUEVA no use este archivo: crear_pansys_test.sql ya crea
--   la columna. Este script solo sirve para una pansys_test creada antes del 004.
-- Requisitos: MySQL 8.0.29 o superior (hoy 8.0.44).
--
-- Cuándo (si hiciera falta): ANTES de ejecutar las pruebas del backend con el código que usa
-- version_sesion (el modelo Usuario declara la columna: sin ella, las pruebas de backend abortan).
--
-- Ejecución: manual en MySQL Workbench, bloque por bloque. No ejecute las pruebas del backend
-- mientras tanto. Si una verificación previa no coincide, DETÉNGASE. El ALTER es una única
-- sentencia DDL atómica; con ALGORITHM=INSTANT no reescribe la tabla y, si no pudiera hacerse
-- de forma instantánea, falla sin cambiar nada. COMMIT implícito: no hay ROLLBACK.
-- Datos esperados: los 4 usuarios de la semilla (las pruebas restauran ese estado al terminar).
-- =====================================================================================

USE pansys_test;

-- =====================================================================================
-- 1. VERIFICACIÓN PREVIA (solo lectura)
-- =====================================================================================

-- 1.1 Esperado: base_actual = pansys_test y version_mysql 8.0.29 o superior
SELECT DATABASE() AS base_actual, VERSION() AS version_mysql;

-- 1.2 Esperado: columna_existe = 0 (MySQL no admite ADD COLUMN IF NOT EXISTS)
SELECT COUNT(*) AS columna_existe
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';

-- 1.3 Requisitos de ALGORITHM=INSTANT. Esperado: motor InnoDB, formato_fila distinto de
--     Compressed, indices_fulltext = 0 y versiones_fila < 64 (límite de cambios instantáneos)
SELECT t.ENGINE AS motor, t.ROW_FORMAT AS formato_fila,
       (SELECT COUNT(*) FROM information_schema.STATISTICS s
        WHERE s.TABLE_SCHEMA = 'pansys_test' AND s.TABLE_NAME = 'usuarios' AND s.INDEX_TYPE = 'FULLTEXT') AS indices_fulltext,
       (SELECT TOTAL_ROW_VERSIONS FROM information_schema.INNODB_TABLES WHERE NAME = 'pansys_test/usuarios') AS versiones_fila
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'usuarios';

-- 1.4 Columna estado (la nueva se coloca después). Esperado: una fila, posición 6
SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'estado';

-- 1.5 Huella de los datos existentes: ANOTE filas y huella; 3.3 debe dar exactamente lo mismo.
--     (Solo muestra un número de control: no revela contraseñas ni hashes.)
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, email, contrasena, rol_id,
         COALESCE(panaderia_id, 'NULL'), COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_test.usuarios;

-- =====================================================================================
-- 2. CAMBIO
-- =====================================================================================
ALTER TABLE pansys_test.usuarios
  ADD COLUMN version_sesion INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Se incrementa al cambiar la contraseña o desactivar la cuenta; invalida los JWT anteriores'
    AFTER estado,
  ALGORITHM = INSTANT;

-- =====================================================================================
-- 3. VERIFICACIÓN POSTERIOR (solo lectura)
-- =====================================================================================

-- 3.1 Esperado: version_sesion | 7 | int unsigned | NO | 0
SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';

-- 3.2 Esperado: filas igual que en 1.5 y con_version_distinta_de_cero = 0
SELECT COUNT(*) AS filas, SUM(version_sesion <> 0) AS con_version_distinta_de_cero
FROM pansys_test.usuarios;

-- 3.3 Esperado: filas y huella IDÉNTICAS a las de 1.5 (ningún dato existente cambió)
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, email, contrasena, rol_id,
         COALESCE(panaderia_id, 'NULL'), COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_test.usuarios;

-- 3.4 Definición completa (debe incluir la columna nueva tras estado)
SHOW CREATE TABLE pansys_test.usuarios;

-- 3.5 Comparación informativa con pansys_db (solo lee information_schema).
--     Si pansys_db aún no tiene el 004: tres filas, version_sesion "falta en pansys_db" y
--     createdAt / updatedAt con "posición" (la columna nueva va antes que ellas). Cuando ambas
--     bases lo tengan: ninguna fila.
SELECT columna, diferencia
FROM (
SELECT CONVERT(t.COLUMN_NAME USING utf8mb4) AS columna,
       CASE WHEN d.COLUMN_NAME IS NULL THEN 'falta en pansys_db'
       ELSE CONCAT_WS(', ',
         IF(t.ORDINAL_POSITION <=> d.ORDINAL_POSITION, NULL, 'posición'),
         IF(t.COLUMN_TYPE      <=> d.COLUMN_TYPE,      NULL, 'tipo'),
         IF(t.IS_NULLABLE      <=> d.IS_NULLABLE,      NULL, 'nulabilidad'),
         IF(t.COLUMN_DEFAULT   <=> d.COLUMN_DEFAULT,   NULL, 'valor por defecto'),
         IF(t.COLUMN_COMMENT   <=> d.COLUMN_COMMENT,   NULL, 'comentario'))
       END AS diferencia
FROM information_schema.COLUMNS t
LEFT JOIN information_schema.COLUMNS d
  ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'usuarios' AND d.COLUMN_NAME = t.COLUMN_NAME
WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'usuarios'
) comparacion
WHERE diferencia <> '';

-- =====================================================================================
-- 4. REVERSIÓN (solo si fuera necesario; comentada a propósito)
-- =====================================================================================
-- Con la columna eliminada, el código que la usa no puede ejecutar las pruebas del backend.
-- Alternativa: recrear la base de pruebas con crear_pansys_test.sql.
-- EFECTO: los tokens invalidados por un cambio de contraseña o una desactivación que aún no
-- hayan caducado (como máximo 8 h) vuelven a ser aceptados. Las contraseñas no cambian.
-- DDL: COMMIT implícito, sin ROLLBACK.
--
-- ALTER TABLE pansys_test.usuarios DROP COLUMN version_sesion, ALGORITHM = INSTANT;
--
-- Verificación tras revertir (esperado: 0):
-- SELECT COUNT(*) FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';
