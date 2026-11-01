-- =====================================================================================
-- Pansys - 005 (base de PRUEBAS): restablecimiento de contraseña y eventos de seguridad
-- =====================================================================================
-- Crea dos tablas nuevas en pansys_test: restablecimientos_contrasena y eventos_seguridad.
-- No modifica ninguna tabla existente ni sus datos. Todas las sentencias nombran
-- explícitamente pansys_test; no se lee ni se toca pansys_db.
--
-- TIPO: migración de la base de PRUEBAS. La versión para pansys_db queda fuera de alcance.
-- ESTADO: NO APLICADO. Su ejecución requiere una autorización expresa.
-- Requisitos: MySQL 8.0.16 o superior de la serie 8.0 (CHECK aplicados); hoy 8.0.44.
--
-- Claves foráneas RESTRICT/RESTRICT: MySQL prohíbe usar en CHECK o en columnas generadas STORED
-- columnas que participen en una clave foránea con ON UPDATE/ON DELETE CASCADE, SET NULL o
-- SET DEFAULT. Si el servidor rechazara alguna definición, el CREATE TABLE falla sin crear nada.
--
-- ANTES DE EJECUTAR (todo con autorización):
--   1. Demo detenida y ninguna otra sesión ni cliente (Workbench, npm run dev, suites).
--   2. Respaldo nuevo de pansys_test (mysqldump --single-transaction) con su SHA-256.
--   3. Fotografía previa: node pruebas/foto_pansys_test.js --guardar <archivo fuera del repo>.
--
-- CÓMO EJECUTAR
--   * UNA sola sesión de principio a fin: las referencias del bloque 1 se guardan en variables
--     de sesión (@ref_*) y las compuertas las exigen. En otra sesión valen NULL y se aborta.
--   * Con un cliente que se DETENGA en el primer error:
--       - MySQL Workbench con «Continue on SQL Script Error» DESACTIVADO, ejecutando cada
--         bloque como UNA selección completa; o
--       - el cliente mysql en modo por lotes (mysql ... < archivo_del_bloque) SIN --force.
--     NO use --force ni `source` / `\.` desde el cliente interactivo (continúa tras un error).
--   * Orden controlado, revisando la salida entre bloques:
--       bloque 1 completo (desde USE) → GUARDE su salida y revísela →
--       bloque 2 completo, de 2.0 a 2.3 en una sola selección (NUNCA un CREATE TABLE suelto) →
--       bloque 3 completo → fotografía posterior.
--   * El error 3141 («Invalid JSON text in argument 1 to function json_type») en una compuerta
--     significa ABORTADO: no continúe, no repita bloques y comunique el resultado.
--   * Cada CREATE TABLE es DDL atómico (COMMIT implícito, sin ROLLBACK). Si el 2.2 funciona y
--     el 2.3 falla, NO repita el bloque 2: use el bloque 4.a (con autorización).
--
-- COMPUERTAS: SQL estático, sin procedimientos almacenados ni escrituras. Forma:
--   SELECT JSON_TYPE(IF(condiciones, '"ok"', 'ABORTAR: ...'));
-- Con todas las condiciones ciertas devuelve STRING. Si alguna es falsa o NULL (por ejemplo,
-- una variable sin calcular), JSON_TYPE recibe un texto que no es JSON y falla con el error
-- 3141; un cliente configurado como se indica arriba se detiene ahí.
--   Lo que AUTOMATIZAN:
--     2.1 (previa, antes de los CREATE TABLE): base actual = pansys_test; versión 8.0.16+ de
--         la serie 8.0; group_concat_max_len, lock_wait_timeout e
--         information_schema_stats_expiry de la sesión; privilegio PROCESS directo; las 10
--         tablas existentes por nombre y ninguna más; ausencia de las dos tablas nuevas;
--         ninguna otra sesión; las 10 referencias @ref_* calculadas (no NULL, sin truncar)
--         antes de que existieran las tablas nuevas.
--     3.5 (posterior): 12 tablas; las 10 existentes por nombre; las dos nuevas vacías, con 17
--         y 8 columnas, 8 y 6 índices, 5 claves foráneas RESTRICT/RESTRICT y 7 + 1 CHECK
--         aplicados; y cada @post_* igual a su @ref_*: conteos de las 10 tablas, huellas de
--         filas de usuarios y panaderias, atributos de tabla, AUTO_INCREMENT, columnas,
--         índices, claves foráneas (con columnas), CHECK y disparadores.
--   Lo que NO automatizan (revisión manual obligatoria):
--     - CHECKSUM TABLE (1.7 frente a 3.3.10): su resultado no puede guardarse en una variable;
--     - que las definiciones de 2.2 y 2.3 sean las acordadas (revise 3.4 SHOW CREATE TABLE);
--     - el indicador truncado y SHOW WARNINGS de las consultas de detalle (las referencias
--       automáticas tienen su propia detección: un truncamiento las deja en NULL);
--     - la fotografía posterior y la zona horaria (informativa).
--     Las consultas de detalle de los bloques 1 y 3 sirven para localizar una diferencia.
--   Lo que NO pueden impedir: que alguien ejecute un CREATE TABLE seleccionado por separado,
--   use --force o `source`, ejecute en otra sesión o que otra sesión se conecte entre la
--   compuerta y el CREATE TABLE. Eso depende del procedimiento descrito arriba.
--
-- PRIVILEGIO PROCESS (1.9): sin PROCESS, PROCESSLIST solo muestra las sesiones de la propia
-- cuenta y «otras_sesiones = 0» no probaría nada. PROCESS es un privilegio exclusivamente
-- global; se busca en INFORMATION_SCHEMA.USER_PRIVILEGES para la cuenta EFECTIVA
-- (CURRENT_USER(): la que MySQL autenticó y cuyos privilegios aplica, no USER()).
-- Limitaciones, todas con resultado seguro (la compuerta ABORTA):
--   - no detecta PROCESS concedido mediante un rol (USER_PRIVILEGES no muestra privilegios de
--     roles);
--   - una cuenta cuyo nombre contenga «@» o comillas no coincide con GRANTEE.
-- Si ocurre, conceda PROCESS directamente a la cuenta (con autorización); no elimine la
-- comprobación.
--
-- CRITERIO DE ACEPTACIÓN: las tablas existentes quedan IDÉNTICAS (compuerta 3.5 superada y
-- CHECKSUM 3.3.10 = 1.7) y la ÚNICA diferencia es la aparición de las dos tablas nuevas,
-- ambas con 0 filas. La fotografía posterior debe mostrar exclusivamente esa diferencia.
-- =====================================================================================

USE pansys_test;
SET SESSION group_concat_max_len = 16777216;
SET SESSION information_schema_stats_expiry = 0;   -- AUTO_INCREMENT actual, sin caché
SET SESSION lock_wait_timeout = 10;                -- no esperar 1 año un bloqueo de metadatos

-- =====================================================================================
-- 1. VERIFICACIÓN PREVIA (solo lectura). GUARDE la salida completa.
-- =====================================================================================

-- 1.1 Esperado: base_actual = pansys_test, versión 8.0.16 o superior de la serie 8.0,
--     group_concat_max_len = 16777216, lock_wait_timeout = 10, information_schema_stats_expiry = 0
SELECT DATABASE() AS base_actual, VERSION() AS version_mysql,
       @@SESSION.group_concat_max_len AS group_concat_max_len,
       @@SESSION.lock_wait_timeout AS lock_wait_timeout,
       @@SESSION.information_schema_stats_expiry AS information_schema_stats_expiry;

-- 1.2 Esperado: tablas_nuevas_existentes = 0 y total_tablas = 10 (las 10 de crear_pansys_test.sql)
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')) AS tablas_nuevas_existentes,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test') AS total_tablas;
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' ORDER BY TABLE_NAME;

-- 1.3 Las listas de columnas de 1.4 están completas. Esperado: panaderias = 8, usuarios = 9
SELECT TABLE_NAME, COUNT(*) AS columnas FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('usuarios', 'panaderias') GROUP BY TABLE_NAME ORDER BY TABLE_NAME;

-- 1.4 SHA-256 por fila de usuarios y panaderias (sin GROUP_CONCAT: no puede truncarse).
--     Solo se muestran resúmenes; JSON_ARRAY distingue NULL y no se confunde con separadores.
SELECT id, SHA2(JSON_ARRAY(id, email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt), 256) AS huella_fila
FROM pansys_test.usuarios ORDER BY id;
SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt), 256) AS huella_fila
FROM pansys_test.panaderias ORDER BY id;

-- 1.5 Esquema de las tablas existentes (detalle para localizar diferencias).
--     DETECCIÓN DE TRUNCAMIENTO en las consultas con GROUP_CONCAT (dos señales):
--       a) truncado: compara la longitud EN BYTES de GROUP_CONCAT con la suma de las longitudes
--          en bytes de sus elementos más los separadores (SEPARATOR '|', siempre 1 byte, sin
--          depender del sql_mode). El límite group_concat_max_len también se mide en bytes.
--          Cada elemento es un JSON_ARRAY convertido a texto utf8mb4: nunca es NULL.
--          Esperado: truncado = 0 en TODAS las filas.
--       b) SHOW WARNINGS inmediatamente después de cada consulta: esperado vacío, sin el aviso
--          1260 («Row N was cut by GROUP_CONCAT()»).
--     Con truncado = 1 en alguna fila o un aviso 1260, el hash de esa consulta NO es concluyente:
--     DETÉNGASE.
-- 1.5.a Columnas
SELECT TABLE_NAME,
       COUNT(*) AS columnas,
       SHA2(GROUP_CONCAT(e ORDER BY ORDINAL_POSITION SEPARATOR '|'), 256) AS huella_columnas,
       LENGTH(GROUP_CONCAT(e ORDER BY ORDINAL_POSITION SEPARATOR '|')) <> SUM(LENGTH(e)) + COUNT(*) - 1 AS truncado
FROM (SELECT TABLE_NAME, ORDINAL_POSITION,
             CAST(JSON_ARRAY(COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
                             COLLATION_NAME, GENERATION_EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
        AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) c
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
SHOW WARNINGS;
-- 1.5.b Índices
SELECT TABLE_NAME,
       COUNT(*) AS entradas_indice,
       SHA2(GROUP_CONCAT(e ORDER BY INDEX_NAME, SEQ_IN_INDEX SEPARATOR '|'), 256) AS huella_indices,
       LENGTH(GROUP_CONCAT(e ORDER BY INDEX_NAME, SEQ_IN_INDEX SEPARATOR '|')) <> SUM(LENGTH(e)) + COUNT(*) - 1 AS truncado
FROM (SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX,
             CAST(JSON_ARRAY(INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE, SUB_PART, COLLATION,
                             IS_VISIBLE, EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
        AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) s
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
SHOW WARNINGS;
-- 1.5.c Atributos de tabla (una fila por tabla: sin GROUP_CONCAT)
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT, CREATE_OPTIONS
FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY TABLE_NAME;
-- 1.5.d Claves foráneas con sus columnas y reglas (una fila por columna: sin GROUP_CONCAT)
SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
       k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
  AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = 'pansys_test' AND k.REFERENCED_TABLE_NAME IS NOT NULL
  AND k.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
-- 1.5.e CHECK (una fila por restricción: sin GROUP_CONCAT)
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, tc.ENFORCED, SHA2(cc.CHECK_CLAUSE, 256) AS huella_check
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND tc.CONSTRAINT_TYPE = 'CHECK'
  AND tc.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;
-- 1.5.f Disparadores de la base (una fila por disparador; puede no haber ninguno)
SELECT EVENT_OBJECT_TABLE, TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_ORDER,
       SHA2(ACTION_STATEMENT, 256) AS huella_cuerpo
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'pansys_test' ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;

-- 1.6 AUTO_INCREMENT de las tablas existentes (sin caché)
SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY TABLE_NAME;

-- 1.7 CHECKSUM de las tablas existentes (comparación MANUAL con 3.3.10)
CHECKSUM TABLE pansys_test.roles, pansys_test.usuarios, pansys_test.panaderias, pansys_test.materia_prima,
  pansys_test.productos, pansys_test.ventas, pansys_test.detalle_ventas, pansys_test.receta_producto,
  pansys_test.orden_produccion, pansys_test.insumo_usado;

-- 1.8 Esperado: otras_sesiones = 0 (válido solo con PROCESS, ver 1.9). Mayor que 0: DETÉNGASE.
--     Zona horaria: solo informativa (el diseño no depende de ella).
SELECT COUNT(*) AS otras_sesiones FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND NOT (USER = 'event_scheduler' AND COMMAND = 'Daemon');
SELECT @@session.time_zone AS zona_sesion, @@global.time_zone AS zona_global;

-- 1.9 Privilegio PROCESS directo de la cuenta efectiva (ver la cabecera). Esperado: tiene_process = 1
SET @tiene_process = (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES
  WHERE PRIVILEGE_TYPE = 'PROCESS'
    AND GRANTEE = CONCAT('''', SUBSTRING_INDEX(CURRENT_USER(), '@', 1), '''@''',
                         SUBSTRING_INDEX(CURRENT_USER(), '@', -1), ''''));
SELECT CURRENT_USER() AS cuenta_efectiva, @tiene_process AS tiene_process;

-- 1.10 Referencias para la comparación automática (compuertas 2.1 y 3.5).
--      Cada huella vale 'vacia' si no hay elementos y NULL si GROUP_CONCAT se truncara
--      (la longitud en bytes no cuadra): un NULL hace abortar la compuerta.
--      Primero se registra que las tablas nuevas aún no existen: si el bloque 1 se repitiera
--      después del bloque 2, la marca valdría 0 y la compuerta 3.5 abortaría.
SET @ref_sin_tablas_nuevas = (SELECT COUNT(*) = 0 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad'));
-- >>> INICIO REFERENCIAS (3.1 repite este texto literal con @post_ en lugar de @ref_)
SET @ref_conteos = CAST(JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado)
) AS CHAR CHARACTER SET utf8mb4);
SET @ref_usuarios = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT id AS k1, SHA2(JSON_ARRAY(id, email, contrasena, rol_id, panaderia_id, estado,
               version_sesion, createdAt, updatedAt), 256) AS e
        FROM pansys_test.usuarios) x);
SET @ref_panaderias = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT id AS k1, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
               createdAt, updatedAt), 256) AS e
        FROM pansys_test.panaderias) x);
SET @ref_tablas = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1,
               CAST(JSON_ARRAY(TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT,
                               CREATE_OPTIONS) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_autoincremento = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1,
               CAST(JSON_ARRAY(TABLE_NAME, AUTO_INCREMENT) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_columnas = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1, ORDINAL_POSITION AS k2,
               CAST(JSON_ARRAY(TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE,
                               COLUMN_DEFAULT, EXTRA, COLLATION_NAME, GENERATION_EXPRESSION)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_indices = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1, INDEX_NAME AS k2, SEQ_IN_INDEX AS k3,
               CAST(JSON_ARRAY(TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE,
                               SUB_PART, COLLATION, IS_VISIBLE, EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_claves = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|'), 256), NULL))
  FROM (SELECT k.TABLE_NAME AS k1, k.CONSTRAINT_NAME AS k2, k.ORDINAL_POSITION AS k3,
               CAST(JSON_ARRAY(k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME,
                               k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
        WHERE k.TABLE_SCHEMA = 'pansys_test' AND k.REFERENCED_TABLE_NAME IS NOT NULL
          AND k.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_checks = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT tc.TABLE_NAME AS k1, cc.CONSTRAINT_NAME AS k2,
               CAST(JSON_ARRAY(tc.TABLE_NAME, cc.CONSTRAINT_NAME, tc.ENFORCED, cc.CHECK_CLAUSE)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
          AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND tc.CONSTRAINT_TYPE = 'CHECK'
          AND tc.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @ref_disparadores = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT EVENT_OBJECT_TABLE AS k1, TRIGGER_NAME AS k2,
               CAST(JSON_ARRAY(TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING,
                               ACTION_ORDER, ACTION_STATEMENT, SQL_MODE, DEFINER) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'pansys_test') x);
-- <<< FIN REFERENCIAS

-- 1.11 Esperado: sin_tablas_nuevas = 1 y NINGÚN valor NULL. GUARDE esta salida.
SELECT @ref_sin_tablas_nuevas AS sin_tablas_nuevas, @ref_conteos AS conteos, @ref_usuarios AS usuarios,
       @ref_panaderias AS panaderias, @ref_tablas AS tablas, @ref_autoincremento AS autoincremento,
       @ref_columnas AS columnas, @ref_indices AS indices, @ref_claves AS claves, @ref_checks AS checks,
       @ref_disparadores AS disparadores;

-- =====================================================================================
-- 2. CAMBIO. Ejecute de 2.0 a 2.3 en UNA sola selección, solo si el bloque 1 es correcto.
-- =====================================================================================

-- 2.0 Valores de sesión justo antes de la compuerta. Esperado: pansys_test, 16777216, 10, 0
SELECT DATABASE() AS base_actual, @@SESSION.group_concat_max_len AS group_concat_max_len,
       @@SESSION.lock_wait_timeout AS lock_wait_timeout,
       @@SESSION.information_schema_stats_expiry AS information_schema_stats_expiry;

-- 2.1 COMPUERTA PREVIA. Esperado: compuerta = STRING. Error 3141: ABORTADO, no continúe.
--     Automatiza solo lo indicado en la cabecera; no sustituye la revisión manual del bloque 1.
SELECT JSON_TYPE(IF(
      DATABASE() = 'pansys_test'
  AND VERSION() LIKE '8.0.%' AND CAST(SUBSTRING_INDEX(VERSION(), '.', -1) AS UNSIGNED) >= 16
  AND @@SESSION.group_concat_max_len = 16777216
  AND @@SESSION.lock_wait_timeout = 10
  AND @@SESSION.information_schema_stats_expiry = 0
  AND @tiene_process = 1
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test') = 10
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('roles', 'usuarios', 'panaderias', 'materia_prima', 'productos', 'ventas',
                            'detalle_ventas', 'receta_producto', 'orden_produccion', 'insumo_usado')) = 10
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')) = 0
  AND (SELECT COUNT(*) FROM information_schema.PROCESSLIST
         WHERE ID <> CONNECTION_ID() AND NOT (USER = 'event_scheduler' AND COMMAND = 'Daemon')) = 0
  AND @ref_sin_tablas_nuevas = 1
  AND @ref_conteos IS NOT NULL AND @ref_usuarios IS NOT NULL AND @ref_panaderias IS NOT NULL
  AND @ref_tablas IS NOT NULL AND @ref_autoincremento IS NOT NULL AND @ref_columnas IS NOT NULL
  AND @ref_indices IS NOT NULL AND @ref_claves IS NOT NULL AND @ref_checks IS NOT NULL
  AND @ref_disparadores IS NOT NULL,
  '"ok"', 'ABORTAR: condiciones previas incorrectas')) AS compuerta;

-- 2.2 Enlaces de restablecimiento. Solo se guarda el SHA-256 del token, nunca el token.
CREATE TABLE pansys_test.restablecimientos_contrasena (
  id INT NOT NULL AUTO_INCREMENT,
  usuario_id INT NOT NULL COMMENT 'Cuenta cuya contraseña se restablece',
  origen ENUM('administrador','propio') NOT NULL COMMENT 'Asistido por un administrador o pedido desde el login',
  solicitado_por INT NULL COMMENT 'Administrador que lo pidió; NULL si el origen es propio',
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 en hexadecimal del token',
  estado ENUM('enviando','activo','usado','invalidado','envio_fallido') NOT NULL DEFAULT 'enviando',
  motivo VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Por qué se invalidó o falló el envío',
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expira_en DATETIME NOT NULL COMMENT 'UTC: 30 minutos desde la reserva',
  enviado_en DATETIME NULL COMMENT 'UTC: SMTP aceptó y el enlace se activó',
  usado_en DATETIME NULL,
  invalidado_en DATETIME NULL,
  fallido_en DATETIME NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  -- Como mucho un enlace 'activo' y una reserva 'enviando' por cuenta (NULL no choca en UNIQUE).
  -- El modelo de Sequelize NO debe declarar estas dos columnas (las calcula MySQL).
  activo_de INT GENERATED ALWAYS AS (IF(estado = 'activo', usuario_id, NULL)) STORED,
  enviando_de INT GENERATED ALWAYS AS (IF(estado = 'enviando', usuario_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rest_token_hash (token_hash),
  UNIQUE KEY uq_rest_activo_por_cuenta (activo_de),
  UNIQUE KEY uq_rest_enviando_por_cuenta (enviando_de),
  KEY idx_rest_usuario_estado (usuario_id, estado),
  KEY idx_rest_usuario_creado (usuario_id, createdAt),
  KEY idx_rest_solicitante_creado (solicitado_por, createdAt),
  KEY idx_rest_expira (expira_en),
  CONSTRAINT fk_rest_usuario FOREIGN KEY (usuario_id) REFERENCES pansys_test.usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_rest_solicitado_por FOREIGN KEY (solicitado_por) REFERENCES pansys_test.usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_rest_token_hash CHECK (REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$', 'c')),
  CONSTRAINT chk_rest_origen CHECK ((origen = 'propio' AND solicitado_por IS NULL)
                                 OR (origen = 'administrador' AND solicitado_por IS NOT NULL)),
  CONSTRAINT chk_rest_no_a_si_mismo CHECK (solicitado_por IS NULL OR solicitado_por <> usuario_id),
  CONSTRAINT chk_rest_expira CHECK (expira_en > createdAt),
  CONSTRAINT chk_rest_intentos CHECK (intentos_fallidos <= 5),
  CONSTRAINT chk_rest_fechas CHECK ((enviado_en IS NULL OR enviado_en >= createdAt)
                                 AND (usado_en IS NULL OR usado_en >= createdAt)
                                 AND (invalidado_en IS NULL OR invalidado_en >= createdAt)
                                 AND (fallido_en IS NULL OR fallido_en >= createdAt)),
  CONSTRAINT chk_rest_estado_coherente CHECK (
       (estado = 'enviando' AND motivo IS NULL AND enviado_en IS NULL AND usado_en IS NULL AND invalidado_en IS NULL AND fallido_en IS NULL)
    OR (estado = 'activo' AND motivo IS NULL AND enviado_en IS NOT NULL AND usado_en IS NULL AND invalidado_en IS NULL AND fallido_en IS NULL)
    OR (estado = 'usado' AND motivo IS NULL AND enviado_en IS NOT NULL AND usado_en IS NOT NULL AND invalidado_en IS NULL AND fallido_en IS NULL)
    OR (estado = 'invalidado' AND invalidado_en IS NOT NULL AND usado_en IS NULL AND fallido_en IS NULL
        AND motivo IN ('nuevo_enlace','email_cambiado','cuenta_desactivada','contrasena_cambiada','intentos','emergencia_local'))
    OR (estado = 'envio_fallido' AND fallido_en IS NOT NULL AND enviado_en IS NULL AND usado_en IS NULL AND invalidado_en IS NULL
        AND motivo IN ('sin_conexion','rechazado','tiempo_agotado','activacion_fallida','proceso_interrumpido'))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2.3 Auditoría. Nunca contraseñas, tokens, hashes, secretos ni direcciones IP. No se modifica.
--     Si esta sentencia falla tras crearse 2.2: NO repita el bloque 2; use 4.a con autorización.
CREATE TABLE pansys_test.eventos_seguridad (
  id INT NOT NULL AUTO_INCREMENT,
  tipo ENUM(
    'restablecimiento_solicitado','restablecimiento_propio_solicitado','restablecimiento_activado',
    'restablecimiento_fallido','restablecimiento_usado','restablecimiento_invalidado',
    'reconfirmacion_fallida','email_cambiado','emergencia_local'
  ) NOT NULL,
  usuario_id INT NOT NULL COMMENT 'Cuenta afectada',
  panaderia_id INT NULL COMMENT 'Panadería de la cuenta afectada EN EL MOMENTO del evento',
  actor_id INT NULL COMMENT 'Quién actuó; NULL = la propia persona sin sesión, el sistema o la emergencia local',
  restablecimiento_id INT NULL COMMENT 'Enlace relacionado; sin clave foránea a propósito (los enlaces se purgan)',
  detalle VARCHAR(255) NULL COMMENT 'Texto breve; nunca datos sensibles',
  createdAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_evento_usuario_creado (usuario_id, createdAt),
  KEY idx_evento_panaderia_creado (panaderia_id, createdAt),
  KEY idx_evento_actor_creado (actor_id, createdAt),
  KEY idx_evento_tipo_creado (tipo, createdAt),
  KEY idx_evento_restablecimiento (restablecimiento_id),
  CONSTRAINT fk_evento_usuario FOREIGN KEY (usuario_id) REFERENCES pansys_test.usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_panaderia FOREIGN KEY (panaderia_id) REFERENCES pansys_test.panaderias (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_actor FOREIGN KEY (actor_id) REFERENCES pansys_test.usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_evento_restablecimiento CHECK (
       (tipo IN ('restablecimiento_solicitado','restablecimiento_propio_solicitado','restablecimiento_activado',
                 'restablecimiento_fallido','restablecimiento_usado','restablecimiento_invalidado')
        AND restablecimiento_id IS NOT NULL)
    OR (tipo IN ('reconfirmacion_fallida','email_cambiado','emergencia_local') AND restablecimiento_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================================
-- 3. VERIFICACIÓN POSTERIOR (solo lectura). Ejecute el bloque completo en la MISMA sesión.
-- =====================================================================================

-- 3.1 Valores posteriores: mismo texto que 1.10 con @post_ (las @ref_* NO se reasignan)
-- >>> INICIO REFERENCIAS (3.1 repite este texto literal con @post_ en lugar de @ref_)
SET @post_conteos = CAST(JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado)
) AS CHAR CHARACTER SET utf8mb4);
SET @post_usuarios = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT id AS k1, SHA2(JSON_ARRAY(id, email, contrasena, rol_id, panaderia_id, estado,
               version_sesion, createdAt, updatedAt), 256) AS e
        FROM pansys_test.usuarios) x);
SET @post_panaderias = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT id AS k1, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
               createdAt, updatedAt), 256) AS e
        FROM pansys_test.panaderias) x);
SET @post_tablas = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1,
               CAST(JSON_ARRAY(TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT,
                               CREATE_OPTIONS) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_autoincremento = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1,
               CAST(JSON_ARRAY(TABLE_NAME, AUTO_INCREMENT) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_columnas = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1, ORDINAL_POSITION AS k2,
               CAST(JSON_ARRAY(TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE,
                               COLUMN_DEFAULT, EXTRA, COLLATION_NAME, GENERATION_EXPRESSION)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_indices = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|'), 256), NULL))
  FROM (SELECT TABLE_NAME AS k1, INDEX_NAME AS k2, SEQ_IN_INDEX AS k3,
               CAST(JSON_ARRAY(TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE,
                               SUB_PART, COLLATION, IS_VISIBLE, EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
          AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_claves = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2, k3 SEPARATOR '|'), 256), NULL))
  FROM (SELECT k.TABLE_NAME AS k1, k.CONSTRAINT_NAME AS k2, k.ORDINAL_POSITION AS k3,
               CAST(JSON_ARRAY(k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME,
                               k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
        WHERE k.TABLE_SCHEMA = 'pansys_test' AND k.REFERENCED_TABLE_NAME IS NOT NULL
          AND k.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_checks = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT tc.TABLE_NAME AS k1, cc.CONSTRAINT_NAME AS k2,
               CAST(JSON_ARRAY(tc.TABLE_NAME, cc.CONSTRAINT_NAME, tc.ENFORCED, cc.CHECK_CLAUSE)
                    AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
          AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND tc.CONSTRAINT_TYPE = 'CHECK'
          AND tc.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) x);
SET @post_disparadores = (SELECT IF(COUNT(*) = 0, 'vacia',
    IF(LENGTH(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1,
       SHA2(GROUP_CONCAT(e ORDER BY k1, k2 SEPARATOR '|'), 256), NULL))
  FROM (SELECT EVENT_OBJECT_TABLE AS k1, TRIGGER_NAME AS k2,
               CAST(JSON_ARRAY(TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING,
                               ACTION_ORDER, ACTION_STATEMENT, SQL_MODE, DEFINER) AS CHAR CHARACTER SET utf8mb4) AS e
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'pansys_test') x);
-- <<< FIN REFERENCIAS

-- 3.2 Tablas nuevas (detalle)
-- 3.2.a Esperado: filas_enlaces = 0 y filas_eventos = 0 (recuento exacto, no TABLE_ROWS)
SELECT (SELECT COUNT(*) FROM pansys_test.restablecimientos_contrasena) AS filas_enlaces,
       (SELECT COUNT(*) FROM pansys_test.eventos_seguridad) AS filas_eventos;
-- 3.2.b Esperado: total_tablas = 12 y la lista = la de 1.2 más EXACTAMENTE las dos tablas nuevas
SELECT COUNT(*) AS total_tablas FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test';
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' ORDER BY TABLE_NAME;
-- 3.2.c Esperado: 5 claves foráneas, todas con UPDATE_RULE y DELETE_RULE = RESTRICT
SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY 1, 2;
-- 3.2.d Esperado: 7 CHECK chk_rest_* en restablecimientos_contrasena y 1 chk_evento_* en
--       eventos_seguridad, todos con ENFORCED = YES
SELECT TABLE_NAME, CONSTRAINT_NAME, ENFORCED FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_TYPE = 'CHECK'
  AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY 1, 2;

-- 3.3 Tablas existentes (detalle): mismas consultas que 1.3 a 1.7. Sirven para localizar una
--     diferencia que señale la compuerta 3.5. truncado = 0 en todas y SHOW WARNINGS vacío.
--     CHECKSUM (3.3.10) se compara A MANO con 1.7. Cualquier diferencia: DETÉNGASE (no
--     restaure nada sin autorización).
-- 3.3.1 (= 1.3)
SELECT TABLE_NAME, COUNT(*) AS columnas FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('usuarios', 'panaderias') GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
-- 3.3.2 (= 1.4)
SELECT id, SHA2(JSON_ARRAY(id, email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt), 256) AS huella_fila
FROM pansys_test.usuarios ORDER BY id;
SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt), 256) AS huella_fila
FROM pansys_test.panaderias ORDER BY id;
-- 3.3.3 (= 1.5.a)
SELECT TABLE_NAME,
       COUNT(*) AS columnas,
       SHA2(GROUP_CONCAT(e ORDER BY ORDINAL_POSITION SEPARATOR '|'), 256) AS huella_columnas,
       LENGTH(GROUP_CONCAT(e ORDER BY ORDINAL_POSITION SEPARATOR '|')) <> SUM(LENGTH(e)) + COUNT(*) - 1 AS truncado
FROM (SELECT TABLE_NAME, ORDINAL_POSITION,
             CAST(JSON_ARRAY(COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
                             COLLATION_NAME, GENERATION_EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
        AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) c
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
SHOW WARNINGS;
-- 3.3.4 (= 1.5.b)
SELECT TABLE_NAME,
       COUNT(*) AS entradas_indice,
       SHA2(GROUP_CONCAT(e ORDER BY INDEX_NAME, SEQ_IN_INDEX SEPARATOR '|'), 256) AS huella_indices,
       LENGTH(GROUP_CONCAT(e ORDER BY INDEX_NAME, SEQ_IN_INDEX SEPARATOR '|')) <> SUM(LENGTH(e)) + COUNT(*) - 1 AS truncado
FROM (SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX,
             CAST(JSON_ARRAY(INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE, SUB_PART, COLLATION,
                             IS_VISIBLE, EXPRESSION) AS CHAR CHARACTER SET utf8mb4) AS e
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
        AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')) s
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
SHOW WARNINGS;
-- 3.3.5 (= 1.5.c)
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT, CREATE_OPTIONS
FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY TABLE_NAME;
-- 3.3.6 (= 1.5.d)
SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
       k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
  AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = 'pansys_test' AND k.REFERENCED_TABLE_NAME IS NOT NULL
  AND k.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
-- 3.3.7 (= 1.5.e)
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, tc.ENFORCED, SHA2(cc.CHECK_CLAUSE, 256) AS huella_check
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND tc.CONSTRAINT_TYPE = 'CHECK'
  AND tc.TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;
-- 3.3.8 (= 1.5.f; incluye las tablas nuevas: no deben tener disparadores)
SELECT EVENT_OBJECT_TABLE, TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_ORDER,
       SHA2(ACTION_STATEMENT, 256) AS huella_cuerpo
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'pansys_test' ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;
-- 3.3.9 (= 1.6)
SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME NOT IN ('restablecimientos_contrasena', 'eventos_seguridad')
ORDER BY TABLE_NAME;
-- 3.3.10 (= 1.7) Comparación MANUAL: cada Checksum debe coincidir con el de 1.7
CHECKSUM TABLE pansys_test.roles, pansys_test.usuarios, pansys_test.panaderias, pansys_test.materia_prima,
  pansys_test.productos, pansys_test.ventas, pansys_test.detalle_ventas, pansys_test.receta_producto,
  pansys_test.orden_produccion, pansys_test.insumo_usado;

-- 3.4 Definición de las tablas nuevas, para revisión MANUAL frente a 2.2 y 2.3
SHOW CREATE TABLE pansys_test.restablecimientos_contrasena;
SHOW CREATE TABLE pansys_test.eventos_seguridad;

-- 3.5 COMPUERTA POSTERIOR (última sentencia del bloque). Esperado: compuerta_posterior = STRING.
--     Error 3141: el cambio está aplicado pero algo no coincide. DETÉNGASE y comunique el
--     resultado; use 3.2 y 3.3 para localizar la diferencia. No revierta sin autorización.
SELECT JSON_TYPE(IF(
      DATABASE() = 'pansys_test'
  AND @ref_sin_tablas_nuevas = 1
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test') = 12
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('roles', 'usuarios', 'panaderias', 'materia_prima', 'productos', 'ventas',
                            'detalle_ventas', 'receta_producto', 'orden_produccion', 'insumo_usado')) = 10
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')) = 2
  AND (SELECT COUNT(*) FROM pansys_test.restablecimientos_contrasena) = 0
  AND (SELECT COUNT(*) FROM pansys_test.eventos_seguridad) = 0
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME = 'restablecimientos_contrasena') = 17
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME = 'eventos_seguridad') = 8
  AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME = 'restablecimientos_contrasena') = 8
  AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
         AND TABLE_NAME = 'eventos_seguridad') = 6
  AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')) = 5
  AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
         AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')
         AND UPDATE_RULE = 'RESTRICT' AND DELETE_RULE = 'RESTRICT') = 5
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
         AND CONSTRAINT_TYPE = 'CHECK' AND TABLE_NAME = 'restablecimientos_contrasena' AND ENFORCED = 'YES') = 7
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
         AND CONSTRAINT_TYPE = 'CHECK' AND TABLE_NAME = 'eventos_seguridad' AND ENFORCED = 'YES') = 1
  AND @post_conteos = @ref_conteos AND @post_usuarios = @ref_usuarios
  AND @post_panaderias = @ref_panaderias AND @post_tablas = @ref_tablas
  AND @post_autoincremento = @ref_autoincremento AND @post_columnas = @ref_columnas
  AND @post_indices = @ref_indices AND @post_claves = @ref_claves
  AND @post_checks = @ref_checks AND @post_disparadores = @ref_disparadores,
  '"ok"', 'DIFERENCIA: verificación posterior fallida')) AS compuerta_posterior;

-- Después: fotografía posterior y comparación con la previa. ÚNICA diferencia admitida: la
-- aparición de las dos tablas nuevas, ambas con 0 filas. Cualquier otra diferencia: DETÉNGASE.

-- =====================================================================================
-- 4. REVERSIÓN (comentada a propósito; NO se ejecuta sin autorización)
-- =====================================================================================
-- Primero se revierte el código que use las tablas. Borra los enlaces y TODA la auditoría:
-- expórtela antes si tuviera datos. No hay claves foráneas entre ellas.
-- Requisitos: la MISMA forma de ejecución que la cabecera (cliente que se detiene en el primer
-- error), una sesión con los SET iniciales y 1.9 ejecutados (@tiene_process = 1), y la
-- compuerta y su DROP TABLE en UNA sola selección. Un error 3141 o 1146 en la compuerta:
-- ABORTADO, no ejecute el DROP. Entre la compuerta y el DROP no debe conectarse nadie (demo
-- detenida): la compuerta no es atómica con el DROP.
--
-- 4.a ESTADO PARCIAL: 2.2 funcionó y 2.3 falló. Solo existe restablecimientos_contrasena.
-- SELECT JSON_TYPE(IF(
--       DATABASE() = 'pansys_test'
--   AND @@SESSION.lock_wait_timeout = 10
--   AND @tiene_process = 1
--   AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
--          AND TABLE_NAME = 'eventos_seguridad') = 0
--   AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
--          AND TABLE_NAME = 'restablecimientos_contrasena') = 17
--   AND (SELECT COUNT(*) FROM pansys_test.restablecimientos_contrasena) = 0
--   AND (SELECT COUNT(*) FROM information_schema.PROCESSLIST
--          WHERE ID <> CONNECTION_ID() AND NOT (USER = 'event_scheduler' AND COMMAND = 'Daemon')) = 0,
--   '"ok"', 'ABORTAR: no es el estado parcial esperado')) AS compuerta_reversion;
-- DROP TABLE pansys_test.restablecimientos_contrasena;
--
-- 4.b REVERSIÓN COMPLETA: existen las dos tablas.
-- SELECT JSON_TYPE(IF(
--       DATABASE() = 'pansys_test'
--   AND @@SESSION.lock_wait_timeout = 10
--   AND @tiene_process = 1
--   AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
--          AND TABLE_NAME = 'restablecimientos_contrasena') = 17
--   AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
--          AND TABLE_NAME = 'eventos_seguridad') = 8
--   AND (SELECT COUNT(*) FROM pansys_test.restablecimientos_contrasena) = 0
--   AND (SELECT COUNT(*) FROM pansys_test.eventos_seguridad) = 0
--   AND (SELECT COUNT(*) FROM information_schema.PROCESSLIST
--          WHERE ID <> CONNECTION_ID() AND NOT (USER = 'event_scheduler' AND COMMAND = 'Daemon')) = 0,
--   '"ok"', 'ABORTAR: hay filas o no es el estado esperado; exporte antes')) AS compuerta_reversion;
-- DROP TABLE pansys_test.eventos_seguridad;
-- DROP TABLE pansys_test.restablecimientos_contrasena;
