-- =====================================================================================
-- 006_reversion_pansys_test.sql   BORRADOR v3 - NO EJECUTAR
-- Deshace cualquier prefijo S0..S7 del 006. Solo elimina objetos cuya definicion y marca SQL006
-- coinciden exactamente; aborta ante cualquier objeto homonimo ajeno, dependencia externa o dato.
-- Idempotente: en S0 no encuentra nada y termina sin cambios.
-- =====================================================================================
SET SESSION lock_wait_timeout = 10;
SET SESSION innodb_lock_wait_timeout = 10;
SET SESSION group_concat_max_len = 16777216;
SET @confirmo_descartar_version_fila = 0;   -- 1 solo con autorizacion escrita

-- ---------------------------------------------- R.0 Compuertas
DO JSON_TYPE(IF(DATABASE() = 'pansys_test', '[]', 'ABORTAR: la base actual no es pansys_test'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES
  WHERE GRANTEE = CONCAT('''', SUBSTRING_INDEX(CURRENT_USER(), '@', 1), '''@''', SUBSTRING_INDEX(CURRENT_USER(), '@', -1), '''')
    AND PRIVILEGE_TYPE = 'PROCESS') = 1, '[]', 'ABORTAR: la cuenta no tiene PROCESS como privilegio directo'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.PROCESSLIST
  WHERE ID <> CONNECTION_ID() AND USER NOT IN ('event_scheduler', 'system user')) = 0,
  '[]', 'ABORTAR: hay otras conexiones de cliente en el servidor'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.EVENTS WHERE STATUS = 'ENABLED') = 0,
  '[]', 'ABORTAR: hay eventos habilitados visibles para esta cuenta'));

-- ---------------------------------------------- R.1 Inventario de objetos
SET @t_rpar = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'red_parejas');
SET @t_sred = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red');
SET @t_dred = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red_detalle');
SET @t_mred = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'movimientos_red');
SET @t_ered = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'eventos_red');
SET @c_ver  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila');
SET @c_loc  = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad');
SET @k_uq   = (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND INDEX_NAME = 'uq_materia_prima_id_panaderia');
SET @k_cver = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_NAME = 'chk_materia_prima_version_fila');
SET @k_cloc = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_NAME = 'chk_panaderias_localidad');
SELECT 'OBJETOS' AS fase, @t_rpar, @t_sred, @t_dred, @t_mred, @t_ered, @c_ver, @c_loc, @k_uq, @k_cver, @k_cloc;

-- ---------------------------------------------- R.2 Definiciones exactas (marca + firma)
-- Firma de una tabla: nombre|tipo|nulo|extra de cada columna, por posicion
SET @f_rpar = (SELECT GROUP_CONCAT(CONCAT_WS('|', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA) ORDER BY ORDINAL_POSITION SEPARATOR ';')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'red_parejas');
SET @f_sred = (SELECT GROUP_CONCAT(CONCAT_WS('|', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA) ORDER BY ORDINAL_POSITION SEPARATOR ';')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red');
SET @f_dred = (SELECT GROUP_CONCAT(CONCAT_WS('|', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA) ORDER BY ORDINAL_POSITION SEPARATOR ';')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red_detalle');
SET @f_mred = (SELECT GROUP_CONCAT(CONCAT_WS('|', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA) ORDER BY ORDINAL_POSITION SEPARATOR ';')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'movimientos_red');
SET @f_ered = (SELECT GROUP_CONCAT(CONCAT_WS('|', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA) ORDER BY ORDINAL_POSITION SEPARATOR ';')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'eventos_red');
SET @m_rpar = (SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'red_parejas');
SET @m_sred = (SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red');
SET @m_dred = (SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'solicitudes_red_detalle');
SET @m_mred = (SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'movimientos_red');
SET @m_ered = (SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'eventos_red');
DO JSON_TYPE(IF(@t_rpar = 0 OR (@m_rpar = 'SQL006 red colaborativa: parejas' AND @f_rpar =
  'panaderia_menor_id|int|NO|;panaderia_mayor_id|int|NO|;pendientes|tinyint unsigned|NO|;createdAt|datetime|NO|;updatedAt|datetime|NO|'),
  '[]', 'ABORTAR: red_parejas no es la creada por el 006'));
DO JSON_TYPE(IF(@t_sred = 0 OR (@m_sred = 'SQL006 red colaborativa: solicitudes' AND @f_sred = CONCAT(
  'id|int|NO|auto_increment;panaderia_solicitante_id|int|NO|;panaderia_proveedora_id|int|NO|;',
  'estado|enum(''pendiente'',''aceptada'',''rechazada'',''cancelada'')|NO|;creada_por|int|NO|;cerrada_por|int|YES|;',
  'cerrada_en|datetime|YES|;nota|varchar(255)|YES|;motivo_rechazo|varchar(255)|YES|;',
  'pareja_menor_id|int|YES|STORED GENERATED;pareja_mayor_id|int|YES|STORED GENERATED;createdAt|datetime|NO|;updatedAt|datetime|NO|')),
  '[]', 'ABORTAR: solicitudes_red no es la creada por el 006'));
DO JSON_TYPE(IF(@t_dred = 0 OR (@m_dred = 'SQL006 red colaborativa: detalle' AND @f_dred = CONCAT(
  'id|int|NO|auto_increment;solicitud_id|int|NO|;linea|tinyint unsigned|NO|;panaderia_solicitante_id|int|NO|;',
  'panaderia_proveedora_id|int|NO|;materia_prima_destino_id|int|NO|;materia_prima_origen_id|int|YES|;',
  'nombre_solicitado|varchar(255)|NO|;unidad_medida|varchar(255)|NO|;cantidad|decimal(12,4)|NO|;',
  'createdAt|datetime|NO|;updatedAt|datetime|NO|')),
  '[]', 'ABORTAR: solicitudes_red_detalle no es la creada por el 006'));
DO JSON_TYPE(IF(@t_mred = 0 OR (@m_mred = 'SQL006 red colaborativa: movimientos' AND @f_mred = CONCAT(
  'id|int|NO|auto_increment;detalle_id|int|NO|;tipo|enum(''salida'',''entrada'')|NO|;panaderia_id|int|NO|;',
  'materia_prima_id|int|NO|;cantidad|decimal(12,4)|NO|;saldo_anterior|decimal(12,4)|NO|;saldo_posterior|decimal(12,4)|NO|;',
  'precio_unitario_referencia|decimal(12,4)|YES|;usuario_id|int|NO|;',
  'salida_materia_id|int|YES|STORED GENERATED;salida_panaderia_id|int|YES|STORED GENERATED;salida_cantidad|decimal(12,4)|YES|STORED GENERATED;',
  'entrada_materia_id|int|YES|STORED GENERATED;entrada_panaderia_id|int|YES|STORED GENERATED;entrada_cantidad|decimal(12,4)|YES|STORED GENERATED;',
  'createdAt|datetime|NO|')),
  '[]', 'ABORTAR: movimientos_red no es la creada por el 006'));
DO JSON_TYPE(IF(@t_ered = 0 OR (@m_ered = 'SQL006 red colaborativa: eventos' AND @f_ered = CONCAT(
  'id|int|NO|auto_increment;solicitud_id|int|NO|;tipo|enum(''creada'',''aceptada'',''rechazada'',''cancelada'')|NO|;',
  'lado|enum(''solicitante'',''proveedora'')|NO|;panaderia_id|int|NO|;actor_id|int|NO|;detalle|varchar(255)|YES|;',
  'solicitante_id|int|YES|STORED GENERATED;proveedora_id|int|YES|STORED GENERATED;cierre_de|int|YES|STORED GENERATED;',
  'createdAt|datetime|NO|')),
  '[]', 'ABORTAR: eventos_red no es la creada por el 006'));
DO JSON_TYPE(IF(@c_ver = 0 OR (SELECT CONCAT_WS('|', COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<NULL>'), EXTRA, COLUMN_COMMENT)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila')
  = 'int unsigned|NO|0||SQL006: concurrencia optimista', '[]', 'ABORTAR: version_fila no es la creada por el 006'));
DO JSON_TYPE(IF(@c_loc = 0 OR (SELECT CONCAT_WS('|', COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<NULL>'), EXTRA, COLUMN_COMMENT)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad')
  = 'varchar(100)|YES|<NULL>||SQL006: localidad o barrio', '[]', 'ABORTAR: localidad no es la creada por el 006'));
DO JSON_TYPE(IF(@k_uq = 0 OR (SELECT CONCAT(GROUP_CONCAT(CONCAT(SEQ_IN_INDEX, ':', COLUMN_NAME) ORDER BY SEQ_IN_INDEX SEPARATOR ','), '|', MAX(NON_UNIQUE), '|', MAX(INDEX_COMMENT))
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND INDEX_NAME = 'uq_materia_prima_id_panaderia')
  = '1:id,2:panaderia_id|0|SQL006', '[]', 'ABORTAR: el indice uq_materia_prima_id_panaderia no es el del 006'));
-- CHECK: tabla y texto. Literales PREVISTOS; se fijan con la salida real del ensayo D1
DO JSON_TYPE(IF(@k_cver = 0 OR (SELECT CONCAT(tc.TABLE_NAME, '|', cc.CHECK_CLAUSE)
  FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc
    ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
  WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND cc.CONSTRAINT_NAME = 'chk_materia_prima_version_fila')
  = 'materia_prima|(`version_fila` < 4294967295)', '[]', 'ABORTAR: chk_materia_prima_version_fila no es el del 006'));
DO JSON_TYPE(IF(@k_cloc = 0 OR (SELECT CONCAT(tc.TABLE_NAME, '|', cc.CHECK_CLAUSE)
  FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc
    ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
  WHERE cc.CONSTRAINT_SCHEMA = 'pansys_test' AND cc.CONSTRAINT_NAME = 'chk_panaderias_localidad')
  = 'panaderias|((`localidad` is null) or (char_length(trim(`localidad`)) > 0))', '[]', 'ABORTAR: chk_panaderias_localidad no es el del 006'));
-- Dependencias externas: nada fuera del 006 puede apoyarse en lo que se va a quitar
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE UNIQUE_CONSTRAINT_SCHEMA = 'pansys_test'
    AND REFERENCED_TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')
    AND NOT (CONSTRAINT_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red'))) = 0,
  '[]', 'ABORTAR: hay FK ajenas que referencian tablas de la red'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
  WHERE REFERENCED_TABLE_SCHEMA = 'pansys_test' AND REFERENCED_TABLE_NAME = 'materia_prima' AND REFERENCED_COLUMN_NAME = 'panaderia_id'
    AND NOT (TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('solicitudes_red_detalle', 'movimientos_red'))) = 0,
  '[]', 'ABORTAR: hay FK ajenas sobre materia_prima(id, panaderia_id)'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
    AND ((TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila') OR (TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad'))) = 0
  AND (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
    AND ((CHECK_CLAUSE LIKE '%`version_fila`%' AND CONSTRAINT_NAME <> 'chk_materia_prima_version_fila')
      OR (CHECK_CLAUSE LIKE '%`localidad`%' AND CONSTRAINT_NAME <> 'chk_panaderias_localidad'))) = 0
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
    AND ((TABLE_NAME = 'materia_prima' AND GENERATION_EXPRESSION LIKE '%version_fila%')
      OR (TABLE_NAME = 'panaderias' AND GENERATION_EXPRESSION LIKE '%localidad%'))) = 0
  AND (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'pansys_test'
    AND (VIEW_DEFINITION LIKE '%version_fila%' OR VIEW_DEFINITION LIKE '%localidad%')) = 0,
  '[]', 'ABORTAR: algun objeto ajeno depende de version_fila o localidad'));

-- ---------------------------------------------- R.3 Huellas previas (columnas originales)
SET @rv_mp = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, unidad_medida, CAST(cantidad_disponible AS CHAR),
          CAST(stock_minimo AS CHAR), CAST(precio_unitario AS CHAR), panaderia_id, estado,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.materia_prima) x);
SET @rv_pan = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.panaderias) x);
SET @rv_esq = (SELECT SHA2(GROUP_CONCAT(j ORDER BY k SEPARATOR '|'), 256) FROM (
    SELECT CONCAT(CAST(TABLE_NAME AS BINARY), '.', CAST(COLUMN_NAME AS BINARY)) AS k,
      JSON_ARRAY(TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME) AS j
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
      AND TABLE_NAME IN ('materia_prima', 'panaderias') AND COLUMN_NAME NOT IN ('version_fila', 'localidad')
    UNION ALL
    SELECT CONCAT('FK.', CAST(CONSTRAINT_NAME AS BINARY)),
      JSON_ARRAY(TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE)
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
      AND (TABLE_NAME IN ('materia_prima', 'panaderias') OR REFERENCED_TABLE_NAME IN ('materia_prima', 'panaderias'))
      AND NOT REGEXP_LIKE(CONSTRAINT_NAME, '^fk_(rpar|sred|dred|mred|ered)_', 'c')) y);
SET @rv_n = JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado));
DO JSON_TYPE(IF(JSON_EXTRACT(@rv_mp, '$[2]') = 1 AND JSON_EXTRACT(@rv_pan, '$[2]') = 1
  AND @rv_esq IS NOT NULL AND @rv_n IS NOT NULL, '[]', 'ABORTAR: huella previa truncada o nula'));
SELECT 'ANTES' AS fase, @rv_mp, @rv_pan, @rv_esq, @rv_n;

-- ---------------------------------------------- R.4 Vacio y datos que se perderian
SET @q = IF(@t_ered = 1, 'SELECT COUNT(*) INTO @n_ered FROM pansys_test.eventos_red', 'SELECT 0 INTO @n_ered');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_mred = 1, 'SELECT COUNT(*) INTO @n_mred FROM pansys_test.movimientos_red', 'SELECT 0 INTO @n_mred');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_dred = 1, 'SELECT COUNT(*) INTO @n_dred FROM pansys_test.solicitudes_red_detalle', 'SELECT 0 INTO @n_dred');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_sred = 1, 'SELECT COUNT(*) INTO @n_sred FROM pansys_test.solicitudes_red', 'SELECT 0 INTO @n_sred');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_rpar = 1, 'SELECT COUNT(*) INTO @n_rpar FROM pansys_test.red_parejas', 'SELECT 0 INTO @n_rpar');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@c_loc = 1, 'SELECT COUNT(*) INTO @n_loc FROM pansys_test.panaderias WHERE localidad IS NOT NULL', 'SELECT 0 INTO @n_loc');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@c_ver = 1, 'SELECT COUNT(*) INTO @n_ver FROM pansys_test.materia_prima WHERE version_fila <> 0', 'SELECT 0 INTO @n_ver');
PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SELECT 'VACIO' AS fase, @n_ered, @n_mred, @n_dred, @n_sred, @n_rpar, @n_loc, @n_ver;
DO JSON_TYPE(IF(@n_ered + @n_mred + @n_dred + @n_sred + @n_rpar = 0, '[]', 'ABORTAR: hay datos en tablas de la red'));
DO JSON_TYPE(IF(@n_loc = 0, '[]', 'ABORTAR: hay localidades rellenadas (se perderian)'));
DO JSON_TYPE(IF(@n_ver = 0 OR @confirmo_descartar_version_fila = 1, '[]', 'ABORTAR: hay version_fila > 0'));

-- ---------------------------------------------- R.5 Eliminacion (hijas -> madres; solo lo que existe)
SET @q = IF(@t_ered = 1, 'DROP TABLE pansys_test.eventos_red', 'DO 0');             PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_mred = 1, 'DROP TABLE pansys_test.movimientos_red', 'DO 0');         PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_dred = 1, 'DROP TABLE pansys_test.solicitudes_red_detalle', 'DO 0'); PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_sred = 1, 'DROP TABLE pansys_test.solicitudes_red', 'DO 0');         PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@t_rpar = 1, 'DROP TABLE pansys_test.red_parejas', 'DO 0');             PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = 'pansys_test'
  AND REFERENCED_TABLE_NAME = 'materia_prima' AND REFERENCED_COLUMN_NAME = 'panaderia_id') = 0,
  '[]', 'ABORTAR: sigue habiendo FK sobre materia_prima(id, panaderia_id)'));
SET @q = IF(@k_cloc = 1, 'ALTER TABLE pansys_test.panaderias DROP CHECK chk_panaderias_localidad', 'DO 0');        PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@c_loc = 1, 'ALTER TABLE pansys_test.panaderias DROP COLUMN localidad', 'DO 0');                       PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@k_cver = 1, 'ALTER TABLE pansys_test.materia_prima DROP CHECK chk_materia_prima_version_fila', 'DO 0'); PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@k_uq = 1, 'ALTER TABLE pansys_test.materia_prima DROP INDEX uq_materia_prima_id_panaderia', 'DO 0');    PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;
SET @q = IF(@c_ver = 1, 'ALTER TABLE pansys_test.materia_prima DROP COLUMN version_fila', 'DO 0');                 PREPARE p FROM @q; EXECUTE p; DEALLOCATE PREPARE p;

-- ---------------------------------------------- R.6 Verificacion final
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
    AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')) = 0
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
    AND ((TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila') OR (TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad'))) = 0
  AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
    AND TABLE_NAME = 'materia_prima' AND INDEX_NAME = 'uq_materia_prima_id_panaderia') = 0
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
    AND (REGEXP_LIKE(CONSTRAINT_NAME, '^(fk|chk|uq)_(rpar|sred|dred|mred|ered)_', 'c')
      OR CONSTRAINT_NAME IN ('chk_materia_prima_version_fila', 'chk_panaderias_localidad'))) = 0,
  '[]', 'ABORTAR: queda algun objeto del 006'));
SET @rf_mp = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, unidad_medida, CAST(cantidad_disponible AS CHAR),
          CAST(stock_minimo AS CHAR), CAST(precio_unitario AS CHAR), panaderia_id, estado,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.materia_prima) x);
SET @rf_pan = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.panaderias) x);
SET @rf_esq = (SELECT SHA2(GROUP_CONCAT(j ORDER BY k SEPARATOR '|'), 256) FROM (
    SELECT CONCAT(CAST(TABLE_NAME AS BINARY), '.', CAST(COLUMN_NAME AS BINARY)) AS k,
      JSON_ARRAY(TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME) AS j
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
      AND TABLE_NAME IN ('materia_prima', 'panaderias') AND COLUMN_NAME NOT IN ('version_fila', 'localidad')
    UNION ALL
    SELECT CONCAT('FK.', CAST(CONSTRAINT_NAME AS BINARY)),
      JSON_ARRAY(TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE)
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
      AND (TABLE_NAME IN ('materia_prima', 'panaderias') OR REFERENCED_TABLE_NAME IN ('materia_prima', 'panaderias'))
      AND NOT REGEXP_LIKE(CONSTRAINT_NAME, '^fk_(rpar|sred|dred|mred|ered)_', 'c')) y);
SET @rf_n = JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado));
DO JSON_TYPE(IF(@rf_mp = @rv_mp AND @rf_pan = @rv_pan AND @rf_esq = @rv_esq AND @rf_n = @rv_n,
  '[]', 'ABORTAR: datos, esquema previo o recuentos cambiaron durante la reversion'));
SELECT 'REVERTIDO' AS fase, @rf_mp, @rf_pan, @rf_esq, @rf_n;
