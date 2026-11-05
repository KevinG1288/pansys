-- =====================================================================================
-- 006_red_colaborativa_pansys_test.sql   BORRADOR v3 PARA REVISION - NO EJECUTAR
-- Base: pansys_test (la variante de produccion solo cambia el nombre de la base).
-- Requisitos: MySQL 8.0.16+, STRICT_TRANS_TABLES, PROCESS directo, condiciones externas
-- cumplidas (aplicacion detenida, sin otros clientes, respaldo verificado). Archivo ASCII.
-- UNA invocacion de mysql por lotes, sin --force: una compuerta falsa da ERROR 3141 y detiene.
-- Cada ALTER/CREATE es DDL atomico. Ante un fallo: ALTO, reversion (archivo aparte) y nueva
-- aplicacion completa. Todos los objetos nuevos llevan la marca SQL006 (comentario) que la
-- reversion exige antes de eliminar nada.
-- red_parejas.pendientes: el CHECK solo LIMITA el contador; su coincidencia con las solicitudes
-- pendientes depende del protocolo transaccional de la aplicacion (crear, aceptar, rechazar y
-- cancelar bloquean la pareja, verifican el recuento y actualizan estado y contador juntos).
-- =====================================================================================
SET SESSION lock_wait_timeout = 10;
SET SESSION innodb_lock_wait_timeout = 10;
SET SESSION group_concat_max_len = 16777216;

-- ======================================================= 1. Compuertas previas
DO JSON_TYPE(IF(DATABASE() = 'pansys_test', '[]', 'ABORTAR: la base actual no es pansys_test'));
DO JSON_TYPE(IF(VERSION() LIKE '8.0.%'
  AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1) AS UNSIGNED) >= 16,
  '[]', 'ABORTAR: se requiere MySQL 8.0.16 o superior de la serie 8.0'));
DO JSON_TYPE(IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0
  AND FIND_IN_SET('STRICT_TRANS_TABLES', @@GLOBAL.sql_mode) > 0, '[]', 'ABORTAR: sql_mode sin STRICT_TRANS_TABLES'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES
  WHERE GRANTEE = CONCAT('''', SUBSTRING_INDEX(CURRENT_USER(), '@', 1), '''@''', SUBSTRING_INDEX(CURRENT_USER(), '@', -1), '''')
    AND PRIVILEGE_TYPE = 'PROCESS') = 1, '[]', 'ABORTAR: la cuenta no tiene PROCESS como privilegio directo'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.PROCESSLIST
  WHERE ID <> CONNECTION_ID() AND USER NOT IN ('event_scheduler', 'system user')) = 0,
  '[]', 'ABORTAR: hay otras conexiones de cliente en el servidor'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.EVENTS WHERE STATUS = 'ENABLED') = 0,
  '[]', 'ABORTAR: hay eventos habilitados visibles para esta cuenta'));

DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('usuarios', 'panaderias', 'materia_prima') AND ENGINE = 'InnoDB') = 3,
  '[]', 'ABORTAR: faltan tablas base InnoDB'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')) = 0,
  '[]', 'ABORTAR: alguna tabla de la red ya existe (ejecute antes la reversion)'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
  AND ((TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila')
    OR (TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad'))) = 0,
  '[]', 'ABORTAR: version_fila o localidad ya existen (ejecute antes la reversion)'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME = 'materia_prima' AND INDEX_NAME = 'uq_materia_prima_id_panaderia') = 0,
  '[]', 'ABORTAR: uq_materia_prima_id_panaderia ya existe'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND (REGEXP_LIKE(CONSTRAINT_NAME, '^(fk|chk|uq)_(rpar|sred|dred|mred|ered)_', 'c')
    OR CONSTRAINT_NAME IN ('chk_materia_prima_version_fila', 'chk_panaderias_localidad'))) = 0,
  '[]', 'ABORTAR: algun nombre de restriccion nuevo ya esta en uso'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
  AND ((TABLE_NAME IN ('usuarios', 'panaderias') AND COLUMN_NAME = 'id')
    OR (TABLE_NAME = 'materia_prima' AND COLUMN_NAME IN ('id', 'panaderia_id')))
  AND COLUMN_TYPE = 'int' AND IS_NULLABLE = 'NO') = 4, '[]', 'ABORTAR: tipos inesperados en columnas referenciadas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'cantidad_disponible'
  AND COLUMN_TYPE = 'decimal(12,4)' AND IS_NULLABLE = 'NO') = 1,
  '[]', 'ABORTAR: cantidad_disponible no es DECIMAL(12,4) NOT NULL (falta el SQL 003)'));

-- ======================================================= 1.H Huellas previas
SET @ref_mp = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, unidad_medida, CAST(cantidad_disponible AS CHAR),
          CAST(stock_minimo AS CHAR), CAST(precio_unitario AS CHAR), panaderia_id, estado,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.materia_prima) x);
SET @ref_pan = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.panaderias) x);
SET @ref_esq = (SELECT SHA2(GROUP_CONCAT(j ORDER BY k SEPARATOR '|'), 256) FROM (
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
SET @ref_n = JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado));
DO JSON_TYPE(IF(JSON_EXTRACT(@ref_mp, '$[2]') = 1 AND JSON_EXTRACT(@ref_pan, '$[2]') = 1
  AND @ref_esq IS NOT NULL AND @ref_n IS NOT NULL, '[]', 'ABORTAR: huella previa truncada o nula'));
SELECT 'ANTES' AS fase, @ref_mp AS materia_prima, @ref_pan AS panaderias, @ref_esq AS esquema, @ref_n AS recuentos;

-- ======================================================= 2. Esquema
-- S1
ALTER TABLE pansys_test.materia_prima
  ADD COLUMN version_fila INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'SQL006: concurrencia optimista' AFTER estado,
  ADD UNIQUE KEY uq_materia_prima_id_panaderia (id, panaderia_id) COMMENT 'SQL006',
  ADD CONSTRAINT chk_materia_prima_version_fila CHECK (version_fila < 4294967295);
-- S2
ALTER TABLE pansys_test.panaderias
  ADD COLUMN localidad VARCHAR(100) NULL COMMENT 'SQL006: localidad o barrio' AFTER direccion,
  ADD CONSTRAINT chk_panaderias_localidad CHECK (localidad IS NULL OR CHAR_LENGTH(TRIM(localidad)) > 0);
-- S3
CREATE TABLE pansys_test.red_parejas (
  panaderia_menor_id INT NOT NULL,
  panaderia_mayor_id INT NOT NULL,
  pendientes TINYINT UNSIGNED NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (panaderia_menor_id, panaderia_mayor_id),
  KEY idx_rpar_mayor (panaderia_mayor_id),
  CONSTRAINT fk_rpar_menor FOREIGN KEY (panaderia_menor_id) REFERENCES pansys_test.panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_rpar_mayor FOREIGN KEY (panaderia_mayor_id) REFERENCES pansys_test.panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_rpar_orden CHECK (panaderia_menor_id < panaderia_mayor_id),
  CONSTRAINT chk_rpar_pendientes CHECK (pendientes <= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: parejas';
-- S4
CREATE TABLE pansys_test.solicitudes_red (
  id INT NOT NULL AUTO_INCREMENT,
  panaderia_solicitante_id INT NOT NULL,
  panaderia_proveedora_id INT NOT NULL,
  estado ENUM('pendiente','aceptada','rechazada','cancelada') NOT NULL DEFAULT 'pendiente',
  creada_por INT NOT NULL,
  cerrada_por INT NULL,
  cerrada_en DATETIME NULL,
  nota VARCHAR(255) NULL,
  motivo_rechazo VARCHAR(255) NULL,
  pareja_menor_id INT GENERATED ALWAYS AS (LEAST(panaderia_solicitante_id, panaderia_proveedora_id)) STORED,
  pareja_mayor_id INT GENERATED ALWAYS AS (GREATEST(panaderia_solicitante_id, panaderia_proveedora_id)) STORED,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sred_id_solicitante (id, panaderia_solicitante_id),
  UNIQUE KEY uq_sred_id_proveedora (id, panaderia_proveedora_id),
  KEY idx_sred_enviadas (panaderia_solicitante_id, estado, createdAt),
  KEY idx_sred_recibidas (panaderia_proveedora_id, estado, createdAt),
  KEY idx_sred_pareja (pareja_menor_id, pareja_mayor_id, estado),
  KEY idx_sred_creada_por (creada_por),
  KEY idx_sred_cerrada_por (cerrada_por),
  CONSTRAINT fk_sred_solicitante FOREIGN KEY (panaderia_solicitante_id) REFERENCES pansys_test.panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_proveedora FOREIGN KEY (panaderia_proveedora_id) REFERENCES pansys_test.panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_pareja FOREIGN KEY (pareja_menor_id, pareja_mayor_id) REFERENCES pansys_test.red_parejas (panaderia_menor_id, panaderia_mayor_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_creada_por FOREIGN KEY (creada_por) REFERENCES pansys_test.usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_cerrada_por FOREIGN KEY (cerrada_por) REFERENCES pansys_test.usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_sred_distintas CHECK (panaderia_solicitante_id <> panaderia_proveedora_id),
  CONSTRAINT chk_sred_cierre CHECK ((estado = 'pendiente' AND cerrada_por IS NULL AND cerrada_en IS NULL)
    OR (estado <> 'pendiente' AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL)),
  CONSTRAINT chk_sred_motivo CHECK (motivo_rechazo IS NULL OR (estado = 'rechazada' AND CHAR_LENGTH(TRIM(motivo_rechazo)) > 0)),
  CONSTRAINT chk_sred_nota CHECK (nota IS NULL OR CHAR_LENGTH(TRIM(nota)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: solicitudes';
-- S5
CREATE TABLE pansys_test.solicitudes_red_detalle (
  id INT NOT NULL AUTO_INCREMENT,
  solicitud_id INT NOT NULL,
  linea TINYINT UNSIGNED NOT NULL,
  panaderia_solicitante_id INT NOT NULL,
  panaderia_proveedora_id INT NOT NULL,
  materia_prima_destino_id INT NOT NULL,
  materia_prima_origen_id INT NULL,
  nombre_solicitado VARCHAR(255) NOT NULL,
  unidad_medida VARCHAR(255) NOT NULL,
  cantidad DECIMAL(12,4) NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dred_linea (solicitud_id, linea),
  UNIQUE KEY uq_dred_destino (solicitud_id, materia_prima_destino_id),
  UNIQUE KEY uq_dred_entrada (id, materia_prima_destino_id, panaderia_solicitante_id, cantidad),
  UNIQUE KEY uq_dred_salida (id, materia_prima_origen_id, panaderia_proveedora_id, cantidad),
  KEY idx_dred_solicitud_solicitante (solicitud_id, panaderia_solicitante_id),
  KEY idx_dred_solicitud_proveedora (solicitud_id, panaderia_proveedora_id),
  KEY idx_dred_destino (materia_prima_destino_id, panaderia_solicitante_id),
  KEY idx_dred_origen (materia_prima_origen_id, panaderia_proveedora_id),
  CONSTRAINT fk_dred_solicitud_solicitante FOREIGN KEY (solicitud_id, panaderia_solicitante_id) REFERENCES pansys_test.solicitudes_red (id, panaderia_solicitante_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_solicitud_proveedora FOREIGN KEY (solicitud_id, panaderia_proveedora_id) REFERENCES pansys_test.solicitudes_red (id, panaderia_proveedora_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_destino FOREIGN KEY (materia_prima_destino_id, panaderia_solicitante_id) REFERENCES pansys_test.materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_origen FOREIGN KEY (materia_prima_origen_id, panaderia_proveedora_id) REFERENCES pansys_test.materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_dred_linea CHECK (linea BETWEEN 1 AND 20),
  CONSTRAINT chk_dred_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_dred_textos CHECK (CHAR_LENGTH(TRIM(nombre_solicitado)) > 0 AND CHAR_LENGTH(TRIM(unidad_medida)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: detalle';
-- S6
CREATE TABLE pansys_test.movimientos_red (
  id INT NOT NULL AUTO_INCREMENT,
  detalle_id INT NOT NULL,
  tipo ENUM('salida','entrada') NOT NULL,
  panaderia_id INT NOT NULL,
  materia_prima_id INT NOT NULL,
  cantidad DECIMAL(12,4) NOT NULL,
  saldo_anterior DECIMAL(12,4) NOT NULL,
  saldo_posterior DECIMAL(12,4) NOT NULL,
  precio_unitario_referencia DECIMAL(12,4) NULL,
  usuario_id INT NOT NULL,
  salida_materia_id INT GENERATED ALWAYS AS (IF(tipo = 'salida', materia_prima_id, NULL)) STORED,
  salida_panaderia_id INT GENERATED ALWAYS AS (IF(tipo = 'salida', panaderia_id, NULL)) STORED,
  salida_cantidad DECIMAL(12,4) GENERATED ALWAYS AS (IF(tipo = 'salida', cantidad, NULL)) STORED,
  entrada_materia_id INT GENERATED ALWAYS AS (IF(tipo = 'entrada', materia_prima_id, NULL)) STORED,
  entrada_panaderia_id INT GENERATED ALWAYS AS (IF(tipo = 'entrada', panaderia_id, NULL)) STORED,
  entrada_cantidad DECIMAL(12,4) GENERATED ALWAYS AS (IF(tipo = 'entrada', cantidad, NULL)) STORED,
  createdAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mred_detalle_tipo (detalle_id, tipo),
  KEY idx_mred_salida (detalle_id, salida_materia_id, salida_panaderia_id, salida_cantidad),
  KEY idx_mred_entrada (detalle_id, entrada_materia_id, entrada_panaderia_id, entrada_cantidad),
  KEY idx_mred_historial (panaderia_id, createdAt),
  KEY idx_mred_materia (materia_prima_id, panaderia_id),
  KEY idx_mred_usuario (usuario_id),
  CONSTRAINT fk_mred_detalle FOREIGN KEY (detalle_id) REFERENCES pansys_test.solicitudes_red_detalle (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_salida FOREIGN KEY (detalle_id, salida_materia_id, salida_panaderia_id, salida_cantidad)
    REFERENCES pansys_test.solicitudes_red_detalle (id, materia_prima_origen_id, panaderia_proveedora_id, cantidad) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_entrada FOREIGN KEY (detalle_id, entrada_materia_id, entrada_panaderia_id, entrada_cantidad)
    REFERENCES pansys_test.solicitudes_red_detalle (id, materia_prima_destino_id, panaderia_solicitante_id, cantidad) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_materia FOREIGN KEY (materia_prima_id, panaderia_id) REFERENCES pansys_test.materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_usuario FOREIGN KEY (usuario_id) REFERENCES pansys_test.usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_mred_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_mred_saldos CHECK (saldo_anterior >= 0 AND saldo_posterior >= 0 AND (
    (tipo = 'salida' AND saldo_posterior = saldo_anterior - cantidad)
    OR (tipo = 'entrada' AND saldo_posterior = saldo_anterior + cantidad)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: movimientos';
-- S7
CREATE TABLE pansys_test.eventos_red (
  id INT NOT NULL AUTO_INCREMENT,
  solicitud_id INT NOT NULL,
  tipo ENUM('creada','aceptada','rechazada','cancelada') NOT NULL,
  lado ENUM('solicitante','proveedora') NOT NULL,
  panaderia_id INT NOT NULL,
  actor_id INT NOT NULL,
  detalle VARCHAR(255) NULL,
  solicitante_id INT GENERATED ALWAYS AS (IF(lado = 'solicitante', panaderia_id, NULL)) STORED,
  proveedora_id INT GENERATED ALWAYS AS (IF(lado = 'proveedora', panaderia_id, NULL)) STORED,
  cierre_de INT GENERATED ALWAYS AS (IF(tipo <> 'creada', solicitud_id, NULL)) STORED,
  createdAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ered_tipo (solicitud_id, tipo),
  UNIQUE KEY uq_ered_un_cierre (cierre_de),
  KEY idx_ered_solicitante (solicitud_id, solicitante_id),
  KEY idx_ered_proveedora (solicitud_id, proveedora_id),
  KEY idx_ered_historial (panaderia_id, createdAt),
  KEY idx_ered_actor (actor_id),
  CONSTRAINT fk_ered_solicitante FOREIGN KEY (solicitud_id, solicitante_id) REFERENCES pansys_test.solicitudes_red (id, panaderia_solicitante_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_proveedora FOREIGN KEY (solicitud_id, proveedora_id) REFERENCES pansys_test.solicitudes_red (id, panaderia_proveedora_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_panaderia FOREIGN KEY (panaderia_id) REFERENCES pansys_test.panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_actor FOREIGN KEY (actor_id) REFERENCES pansys_test.usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_ered_lado CHECK ((tipo IN ('creada', 'cancelada') AND lado = 'solicitante')
    OR (tipo IN ('aceptada', 'rechazada') AND lado = 'proveedora')),
  CONSTRAINT chk_ered_detalle CHECK (detalle IS NULL OR CHAR_LENGTH(TRIM(detalle)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: eventos';

-- ======================================================= 3. Verificacion posterior
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND ENGINE = 'InnoDB'
  AND ((TABLE_NAME = 'red_parejas' AND TABLE_COMMENT = 'SQL006 red colaborativa: parejas')
    OR (TABLE_NAME = 'solicitudes_red' AND TABLE_COMMENT = 'SQL006 red colaborativa: solicitudes')
    OR (TABLE_NAME = 'solicitudes_red_detalle' AND TABLE_COMMENT = 'SQL006 red colaborativa: detalle')
    OR (TABLE_NAME = 'movimientos_red' AND TABLE_COMMENT = 'SQL006 red colaborativa: movimientos')
    OR (TABLE_NAME = 'eventos_red' AND TABLE_COMMENT = 'SQL006 red colaborativa: eventos'))) = 5,
  '[]', 'ABORTAR: no estan las 5 tablas marcadas'));
DO JSON_TYPE(IF((SELECT CONCAT_WS('|', COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<NULL>'), EXTRA, COLUMN_COMMENT)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila')
  = 'int unsigned|NO|0||SQL006: concurrencia optimista'
  AND (SELECT CONCAT_WS('|', COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<NULL>'), EXTRA, COLUMN_COMMENT)
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad')
  = 'varchar(100)|YES|<NULL>||SQL006: localidad o barrio', '[]', 'ABORTAR: columnas nuevas inesperadas'));
DO JSON_TYPE(IF((SELECT CONCAT(GROUP_CONCAT(CONCAT(SEQ_IN_INDEX, ':', COLUMN_NAME) ORDER BY SEQ_IN_INDEX SEPARATOR ','), '|', MAX(NON_UNIQUE), '|', MAX(INDEX_COMMENT))
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND INDEX_NAME = 'uq_materia_prima_id_panaderia')
  = '1:id,2:panaderia_id|0|SQL006', '[]', 'ABORTAR: indice uq_materia_prima_id_panaderia inesperado'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.materia_prima WHERE version_fila <> 0) = 0
  AND (SELECT COUNT(*) FROM pansys_test.panaderias WHERE localidad IS NOT NULL) = 0, '[]', 'ABORTAR: valores iniciales inesperados'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')) = 20
  AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')
  AND UPDATE_RULE = 'RESTRICT' AND DELETE_RULE = 'RESTRICT') = 20, '[]', 'ABORTAR: no hay exactamente 20 FK RESTRICT/RESTRICT'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES'
  AND (REGEXP_LIKE(CONSTRAINT_NAME, '^chk_(rpar|sred|dred|mred|ered)_', 'c')
    OR CONSTRAINT_NAME IN ('chk_materia_prima_version_fila', 'chk_panaderias_localidad'))) = 15,
  '[]', 'ABORTAR: no hay exactamente 15 CHECK aplicados'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.red_parejas) + (SELECT COUNT(*) FROM pansys_test.solicitudes_red)
  + (SELECT COUNT(*) FROM pansys_test.solicitudes_red_detalle) + (SELECT COUNT(*) FROM pansys_test.movimientos_red)
  + (SELECT COUNT(*) FROM pansys_test.eventos_red) = 0, '[]', 'ABORTAR: las tablas nuevas no estan vacias'));
-- Huellas posteriores: mismas expresiones que 1.H en @post_mp, @post_pan, @post_esq, @post_n
SET @post_mp = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, unidad_medida, CAST(cantidad_disponible AS CHAR),
          CAST(stock_minimo AS CHAR), CAST(precio_unitario AS CHAR), panaderia_id, estado,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.materia_prima) x);
SET @post_pan = (SELECT JSON_ARRAY(COUNT(*), SHA2(GROUP_CONCAT(e ORDER BY id SEPARATOR '|'), 256),
    IF(COUNT(*) = 0 OR LENGTH(GROUP_CONCAT(e ORDER BY id SEPARATOR '|')) = SUM(LENGTH(e)) + COUNT(*) - 1, 1, 0))
  FROM (SELECT id, SHA2(JSON_ARRAY(id, nombre, direccion, telefono, en_red, usuario_id,
          CAST(createdAt AS CHAR), CAST(updatedAt AS CHAR)), 256) AS e FROM pansys_test.panaderias) x);
SET @post_esq = (SELECT SHA2(GROUP_CONCAT(j ORDER BY k SEPARATOR '|'), 256) FROM (
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
SET @post_n = JSON_ARRAY(
  (SELECT COUNT(*) FROM pansys_test.roles), (SELECT COUNT(*) FROM pansys_test.usuarios),
  (SELECT COUNT(*) FROM pansys_test.panaderias), (SELECT COUNT(*) FROM pansys_test.materia_prima),
  (SELECT COUNT(*) FROM pansys_test.productos), (SELECT COUNT(*) FROM pansys_test.ventas),
  (SELECT COUNT(*) FROM pansys_test.detalle_ventas), (SELECT COUNT(*) FROM pansys_test.receta_producto),
  (SELECT COUNT(*) FROM pansys_test.orden_produccion), (SELECT COUNT(*) FROM pansys_test.insumo_usado));
DO JSON_TYPE(IF(@post_mp = @ref_mp AND @post_pan = @ref_pan AND @post_esq = @ref_esq AND @post_n = @ref_n,
  '[]', 'ABORTAR: datos, esquema previo o recuentos cambiaron'));
SELECT 'DESPUES' AS fase, @post_mp, @post_pan, @post_esq, @post_n;
-- Texto real de los CHECK (lo registra el ensayo D1 para fijar los literales de la reversion)
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test'
  AND CONSTRAINT_NAME IN ('chk_materia_prima_version_fila', 'chk_panaderias_localidad');
SHOW CREATE TABLE pansys_test.materia_prima;
SHOW CREATE TABLE pansys_test.panaderias;
SHOW CREATE TABLE pansys_test.red_parejas;
SHOW CREATE TABLE pansys_test.solicitudes_red;
SHOW CREATE TABLE pansys_test.solicitudes_red_detalle;
SHOW CREATE TABLE pansys_test.movimientos_red;
SHOW CREATE TABLE pansys_test.eventos_red;
