-- =====================================================================================
-- Pansys - 004: versión de sesión para invalidar los JWT anteriores
-- =====================================================================================
-- Añade usuarios.version_sesion INT UNSIGNED NOT NULL DEFAULT 0. El backend la incluye en
-- cada JWT y la compara con la de la base en cada petición autenticada; se incrementa al
-- cambiar la contraseña y al desactivar una cuenta, así que los tokens emitidos antes dejan
-- de funcionar al instante. Los tokens sin esta propiedad cuentan como versión 0.
--
-- TIPO: migración de producción y registro histórico del cambio aplicado.
--
-- ESTADO: YA APLICADO en pansys_db el 2026-10-20, con todas las verificaciones previas y
--   posteriores correctas (respaldo previo: pansys_db_antes_004.sql, fuera del repositorio).
--   NO LO VUELVA A EJECUTAR sobre pansys_db. Si se ejecuta por error, el paso 1.2 muestra
--   columna_existe = 1 (DETÉNGASE ahí) y, aunque se siguiera, el ALTER falla con el error 1060
--   (columna duplicada) sin cambiar nada.
--   Solo sirve para una pansys_db que aún no la tenga (p. ej. restaurada desde una copia
--   anterior al cambio). Para una base de PRUEBAS nueva, use pruebas/crear_pansys_test.sql,
--   que ya incluye la columna.
-- Requisitos: MySQL 8.0.29 o superior (ADD COLUMN ... AFTER con ALGORITHM=INSTANT; hoy 8.0.44).
-- Independiente de 003.
--
-- ORDEN DE DESPLIEGUE (el que se siguió; vale para aplicarlo en otra base):
--   1. Aplicar backend/database/pruebas/004_version_sesion_pansys_test.sql y ejecutar las pruebas.
--   2. Copia de seguridad de pansys_db (Workbench: Server > Data Export).
--   3. Aplicar ESTE archivo en pansys_db.
--   4. Arrancar el backend con el código que usa la columna.
--   El modelo Usuario declara version_sesion: con ese código y SIN esta columna, el login y
--   todas las peticiones autenticadas fallan ("Unknown column 'version_sesion'").
--
-- Ejecución: manual en MySQL Workbench, bloque por bloque. Si una verificación previa no
-- coincide con lo esperado, DETÉNGASE. El ALTER es una única sentencia DDL atómica y con
-- ALGORITHM=INSTANT no reescribe la tabla: si MySQL no pudiera hacerlo de forma instantánea,
-- falla sin cambiar nada (no recurre a copiar la tabla). Hace COMMIT implícito: no hay ROLLBACK.
-- =====================================================================================

USE pansys_db;

-- =====================================================================================
-- 1. VERIFICACIÓN PREVIA (solo lectura)
-- =====================================================================================

-- 1.1 Esperado: base_actual = pansys_db y version_mysql 8.0.29 o superior
SELECT DATABASE() AS base_actual, VERSION() AS version_mysql;

-- 1.2 Esperado: columna_existe = 0 (MySQL no admite ADD COLUMN IF NOT EXISTS)
SELECT COUNT(*) AS columna_existe
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_db' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';

-- 1.3 Requisitos de ALGORITHM=INSTANT. Esperado: motor InnoDB, formato_fila distinto de
--     Compressed, indices_fulltext = 0 y versiones_fila < 64 (límite de cambios instantáneos)
SELECT t.ENGINE AS motor, t.ROW_FORMAT AS formato_fila,
       (SELECT COUNT(*) FROM information_schema.STATISTICS s
        WHERE s.TABLE_SCHEMA = 'pansys_db' AND s.TABLE_NAME = 'usuarios' AND s.INDEX_TYPE = 'FULLTEXT') AS indices_fulltext,
       (SELECT TOTAL_ROW_VERSIONS FROM information_schema.INNODB_TABLES WHERE NAME = 'pansys_db/usuarios') AS versiones_fila
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = 'pansys_db' AND t.TABLE_NAME = 'usuarios';

-- 1.4 Columna estado (la nueva se coloca después). Esperado: una fila, posición 6
SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_db' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'estado';

-- 1.5 Huella de los datos existentes: ANOTE filas y huella; 3.3 debe dar exactamente lo mismo.
--     (Solo muestra un número de control: no revela contraseñas ni hashes.)
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, email, contrasena, rol_id,
         COALESCE(panaderia_id, 'NULL'), COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_db.usuarios;

-- =====================================================================================
-- 2. CAMBIO
-- =====================================================================================
ALTER TABLE pansys_db.usuarios
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
WHERE TABLE_SCHEMA = 'pansys_db' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';

-- 3.2 Esperado: filas igual que en 1.5 y con_version_distinta_de_cero = 0
SELECT COUNT(*) AS filas, SUM(version_sesion <> 0) AS con_version_distinta_de_cero
FROM pansys_db.usuarios;

-- 3.3 Esperado: filas y huella IDÉNTICAS a las de 1.5 (ningún dato existente cambió)
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, email, contrasena, rol_id,
         COALESCE(panaderia_id, 'NULL'), COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_db.usuarios;

-- 3.4 Definición completa (debe incluir la columna nueva tras estado)
SHOW CREATE TABLE pansys_db.usuarios;

-- =====================================================================================
-- 4. REVERSIÓN (solo si fuera necesario; comentada a propósito)
-- =====================================================================================
-- ORDEN: revierta PRIMERO el código (modelo Usuario, login, middleware, cambio de contraseña y
-- desactivación de cuentas) y DESPUÉS la columna. Al revés, el backend falla con "Unknown column".
-- EFECTO: los tokens invalidados por un cambio de contraseña o una desactivación que aún no
-- hayan caducado (como máximo 8 h) vuelven a ser aceptados. Las contraseñas no cambian.
-- DDL: COMMIT implícito, sin ROLLBACK.
--
-- ALTER TABLE pansys_db.usuarios DROP COLUMN version_sesion, ALGORITHM = INSTANT;
--
-- Verificación tras revertir (esperado: 0):
-- SELECT COUNT(*) FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'pansys_db' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion';
