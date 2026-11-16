-- =====================================================================================
-- Pansys - INSTALACIÓN LIMPIA, paso 1 de 4: esquema completo en una base NUEVA y VACÍA
-- =====================================================================================
-- Crea las 17 tablas en su estado final (equivale a 001 + 002 + 003 + 004 + 005 + 006 aplicados)
-- y los tres roles fijos (src/config/roles.js). NO crea usuarios, panaderías, productos, ventas,
-- contraseñas ni datos de demostración: las dos panaderías y sus administradores se crean después
-- con 02_instalar_panaderias.js.
--
-- No nombra ninguna base ni ningún servidor: trabaja sobre la base ACTUAL de la conexión y exige que
-- la sesión traiga la identidad ESPERADA del servidor en @pansys_uuid, @pansys_puerto y
-- @pansys_datadir. Forma recomendada (vea INSTALACION.md), que además comprueba el SHA-256 aprobado:
--   node database/instalacion/ejecutar_sql.js --parametros=<JSON> --script=01_esquema.sql --cuenta=instalador
-- Alternativa con el cliente mysql: UNA invocación, sin --force, desde cmd.exe (en PowerShell 5.1
-- «<» no existe y la tubería «|» recodifica el archivo y estropea los acentos de los COMMENT):
--   cmd /c "mysql --no-defaults --protocol=TCP -h <host> -P <puerto> -u <cuenta> -p --default-character-set=utf8mb4 --batch
--           "--init-command=SET @pansys_uuid='<uuid>', @pansys_puerto=<puerto>, @pansys_datadir='<datadir con \\>'"
--           <base_nueva> < 01_esquema.sql"
-- Una compuerta falsa provoca ERROR 3141. En MySQL 8.0.44 su mensaje NO incluye el texto «ABORTAR»
-- (solo «Invalid JSON text ... "Invalid value." at position 0»): la compuerta que ha fallado se
-- identifica por el número de línea que da el cliente («at line N») o por ejecutar_sql.js, que
-- muestra el texto «ABORTAR: ...» de esa sentencia tomado de este archivo.
--
-- Barreras (sección 1), todas antes de crear nada:
--   * identidad POSITIVA: @@server_uuid, @@port y @@datadir iguales a los esperados (sin valores
--     fijos en este archivo; si faltan las variables, aborta);
--   * hay base seleccionada y no es pansys_test;
--   * MySQL 8.0.16+ de la serie 8.0 (CHECK aplicados), STRICT_TRANS_TABLES y foreign_key_checks = 1;
--   * la base usa utf8mb4 / utf8mb4_0900_ai_ci;
--   * la base está VACÍA (ni tablas, ni vistas, ni rutinas, ni disparadores, ni eventos).
--   Una base con datos (pansys_db, pansys_test, cualquier otra en uso) nunca pasa la última.
--
-- Diferencias deliberadas respecto a pansys_test (ver INSTALACION.md, «Diferencias conocidas»):
--   * usuarios tiene UN solo índice único en email (pansys_test arrastra email_2 ... email_59,
--     duplicados que dejó un sync() antiguo de Sequelize; no aportan nada).
--   * El ciclo usuarios <-> panaderias se resuelve sin desactivar foreign_key_checks: usuarios se
--     crea sin la clave hacia panaderias y se añade con ALTER TABLE en cuanto panaderias existe.
--   * version_fila y uq_materia_prima_id_panaderia (materia_prima) y localidad (panaderias) se
--     declaran en el CREATE TABLE en lugar de añadirse con ALTER; mismo tipo, posición y marca SQL006.
--   * Sin las compuertas propias de pansys_test del SQL 005/006 (PROCESS, otras conexiones,
--     huellas de datos previos): en una base nueva no hay datos que proteger. Se conservan TODAS
--     las restricciones de integridad (claves foráneas, CHECK, únicos, columnas generadas).
--
-- Fallo a mitad: cada CREATE/ALTER es DDL atómico con COMMIT implícito (no hay ROLLBACK). Si el
-- script se detiene después de crear alguna tabla, la base queda incompleta: NO lo repita sobre
-- ella. Elimine esa base NUEVA (solo esa, y solo si no contiene datos reales), créela otra vez
-- vacía y ejecute el script completo. Procedimiento en INSTALACION.md.
-- =====================================================================================
-- ======================================================= 1. Compuertas previas
DO JSON_TYPE(IF(@pansys_uuid IS NOT NULL AND @pansys_puerto IS NOT NULL AND @pansys_datadir IS NOT NULL
  AND CAST(@@server_uuid AS BINARY) = CAST(@pansys_uuid AS BINARY) AND @@port = @pansys_puerto
  AND CAST(@@datadir AS BINARY) = CAST(@pansys_datadir AS BINARY),
  '[]', 'ABORTAR: identidad del servidor no verificada (server_uuid, puerto o datadir distintos o sin definir)'));
SET SESSION lock_wait_timeout = 10;
SET SESSION innodb_lock_wait_timeout = 10;
DO JSON_TYPE(IF(DATABASE() IS NOT NULL, '[]', 'ABORTAR: no hay base seleccionada (indique la base nueva en la linea de mysql)'));
DO JSON_TYPE(IF(LOWER(DATABASE()) <> 'pansys_test', '[]', 'ABORTAR: pansys_test es la base de pruebas'));
DO JSON_TYPE(IF(VERSION() LIKE '8.0.%'
  AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1) AS UNSIGNED) >= 16,
  '[]', 'ABORTAR: se requiere MySQL 8.0.16 o superior de la serie 8.0'));
DO JSON_TYPE(IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0, '[]', 'ABORTAR: sql_mode sin STRICT_TRANS_TABLES'));
DO JSON_TYPE(IF(@@SESSION.foreign_key_checks = 1, '[]', 'ABORTAR: foreign_key_checks debe valer 1'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()
  AND DEFAULT_CHARACTER_SET_NAME = 'utf8mb4' AND DEFAULT_COLLATION_NAME = 'utf8mb4_0900_ai_ci') = 1,
  '[]', 'ABORTAR: la base no usa utf8mb4 / utf8mb4_0900_ai_ci'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE())
  + (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE())
  + (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE())
  + (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()) = 0,
  '[]', 'ABORTAR: la base no esta vacia (este script solo instala en una base nueva)'));

-- ======================================================= 2. Esquema (orden de dependencias)
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- La clave usuarios.panaderia_id -> panaderias se añade después de crear panaderias (ciclo).
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `contrasena` varchar(255) NOT NULL,
  `rol_id` int NOT NULL,
  `panaderia_id` int DEFAULT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `version_sesion` int unsigned NOT NULL DEFAULT '0' COMMENT 'Se incrementa al cambiar la contraseña o desactivar la cuenta; invalida los JWT anteriores',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `rol_id` (`rol_id`),
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `usuarios_ibfk_3` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `panaderias` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `direccion` varchar(255) NOT NULL,
  `localidad` varchar(100) DEFAULT NULL COMMENT 'SQL006: localidad o barrio',
  `telefono` varchar(255) DEFAULT NULL,
  `en_red` tinyint(1) DEFAULT '0',
  `usuario_id` int NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `panaderias_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_panaderias_localidad` CHECK (localidad IS NULL OR CHAR_LENGTH(TRIM(localidad)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Cierre del ciclo: ahora panaderias existe y la clave se crea con foreign_key_checks = 1.
ALTER TABLE `usuarios`
  ADD CONSTRAINT `usuarios_ibfk_4` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `materia_prima` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `unidad_medida` varchar(255) NOT NULL,
  `cantidad_disponible` decimal(12,4) NOT NULL DEFAULT '0.0000',
  `stock_minimo` decimal(12,4) NOT NULL DEFAULT '0.0000',
  `precio_unitario` decimal(12,4) NOT NULL DEFAULT '0.0000',
  `panaderia_id` int NOT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `version_fila` int unsigned NOT NULL DEFAULT '0' COMMENT 'SQL006: concurrencia optimista',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_materia_prima_id_panaderia` (`id`,`panaderia_id`) COMMENT 'SQL006',
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `materia_prima_ibfk_1` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_materia_prima_version_fila` CHECK (version_fila < 4294967295)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `productos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `precio_compra` float DEFAULT '0',
  `precio_venta` float NOT NULL,
  `cantidad_disponible` int DEFAULT '0',
  `panaderia_id` int NOT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ventas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fecha` date DEFAULT NULL,
  `total` float DEFAULT '0',
  `empleado_id` int NOT NULL,
  `panaderia_id` int NOT NULL,
  `estado` varchar(255) DEFAULT 'completada',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `ventas_ibfk_1` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `detalle_ventas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `venta_id` int NOT NULL,
  `producto_id` int NOT NULL,
  `cantidad` int NOT NULL,
  `precio_unitario` float NOT NULL,
  `subtotal` float NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `venta_id` (`venta_id`),
  KEY `producto_id` (`producto_id`),
  CONSTRAINT `detalle_ventas_ibfk_45` FOREIGN KEY (`venta_id`) REFERENCES `ventas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `detalle_ventas_ibfk_46` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `receta_producto` (
  `id` int NOT NULL AUTO_INCREMENT,
  `producto_id` int NOT NULL,
  `materia_prima_id` int NOT NULL,
  `cantidad_por_unidad` decimal(12,4) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receta` (`producto_id`,`materia_prima_id`),
  KEY `fk_receta_materia` (`materia_prima_id`),
  CONSTRAINT `fk_receta_materia` FOREIGN KEY (`materia_prima_id`) REFERENCES `materia_prima` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_receta_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_receta_cantidad` CHECK ((`cantidad_por_unidad` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `orden_produccion` (
  `id` int NOT NULL AUTO_INCREMENT,
  `panaderia_id` int NOT NULL,
  `producto_id` int NOT NULL,
  `empleado_id` int NOT NULL,
  `fecha` date NOT NULL,
  `cantidad_planificada` int NOT NULL,
  `cantidad_producida` int DEFAULT NULL,
  `estado` enum('en_proceso','finalizada','cancelada') NOT NULL DEFAULT 'en_proceso',
  `costo_insumos` decimal(12,2) NOT NULL DEFAULT '0.00',
  `observaciones` varchar(500) DEFAULT NULL,
  `motivo_cancelacion` varchar(500) DEFAULT NULL,
  `insumos_devueltos` tinyint(1) NOT NULL DEFAULT '0',
  `fecha_finalizacion` datetime DEFAULT NULL,
  `cerrado_por` int DEFAULT NULL COMMENT 'Usuario que finalizó o canceló la orden',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_orden_panaderia_estado` (`panaderia_id`,`estado`),
  KEY `fk_orden_producto` (`producto_id`),
  KEY `fk_orden_empleado` (`empleado_id`),
  KEY `fk_orden_cerrado_por` (`cerrado_por`),
  CONSTRAINT `fk_orden_cerrado_por` FOREIGN KEY (`cerrado_por`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_orden_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_orden_panaderia` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_orden_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_orden_estado_coherente` CHECK ((((`estado` = _utf8mb4'en_proceso') and (`cantidad_producida` is null) and (`fecha_finalizacion` is null) and (`motivo_cancelacion` is null) and (`insumos_devueltos` = 0)) or ((`estado` = _utf8mb4'finalizada') and (`cantidad_producida` is not null) and (`fecha_finalizacion` is not null) and (`motivo_cancelacion` is null) and (`insumos_devueltos` = 0)) or ((`estado` = _utf8mb4'cancelada') and (`cantidad_producida` is null) and (`fecha_finalizacion` is not null) and (`motivo_cancelacion` is not null)))),
  CONSTRAINT `chk_orden_planificada` CHECK ((`cantidad_planificada` > 0)),
  CONSTRAINT `chk_orden_producida` CHECK (((`cantidad_producida` is null) or (`cantidad_producida` >= 0))),
  CONSTRAINT `chk_orden_producida_max` CHECK (((`cantidad_producida` is null) or (`cantidad_producida` <= `cantidad_planificada`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `insumo_usado` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orden_id` int NOT NULL,
  `materia_prima_id` int NOT NULL,
  `cantidad_por_unidad` decimal(12,4) NOT NULL COMMENT 'Copia de la receta al crear la orden',
  `unidad_medida` varchar(255) NOT NULL COMMENT 'Copia de materia_prima.unidad_medida al crear la orden',
  `precio_unitario` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT 'Copia de materia_prima.precio_unitario al crear la orden',
  `cantidad_usada` decimal(12,4) NOT NULL COMMENT 'Cantidad DESCONTADA del inventario al crear la orden',
  `cantidad_consumida` decimal(12,4) NOT NULL DEFAULT '0.0000' COMMENT 'Convertida en producto (solo al finalizar)',
  `cantidad_devuelta` decimal(12,4) NOT NULL DEFAULT '0.0000' COMMENT 'Devuelta al inventario al cancelar',
  `cantidad_mermada` decimal(12,4) NOT NULL DEFAULT '0.0000' COMMENT 'Perdida al cancelar (descontada - devuelta)',
  `costo` decimal(12,2) NOT NULL DEFAULT '0.00',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_insumo_orden` (`orden_id`,`materia_prima_id`),
  KEY `fk_insumo_materia` (`materia_prima_id`),
  CONSTRAINT `fk_insumo_materia` FOREIGN KEY (`materia_prima_id`) REFERENCES `materia_prima` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_insumo_orden` FOREIGN KEY (`orden_id`) REFERENCES `orden_produccion` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `chk_insumo_cantidad` CHECK ((`cantidad_usada` > 0)),
  CONSTRAINT `chk_insumo_copia_valida` CHECK (((`cantidad_por_unidad` > 0) and (`precio_unitario` >= 0) and (`costo` >= 0))),
  CONSTRAINT `chk_insumo_no_excede` CHECK ((((`cantidad_consumida` + `cantidad_devuelta`) + `cantidad_mermada`) <= `cantidad_usada`)),
  CONSTRAINT `chk_insumo_no_negativos` CHECK (((`cantidad_consumida` >= 0) and (`cantidad_devuelta` >= 0) and (`cantidad_mermada` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SQL 005: enlaces de restablecimiento. Solo se guarda el SHA-256 del token, nunca el token.
CREATE TABLE restablecimientos_contrasena (
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
  CONSTRAINT fk_rest_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_rest_solicitado_por FOREIGN KEY (solicitado_por) REFERENCES usuarios (id)
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

-- SQL 005: auditoría. Nunca contraseñas, tokens, hashes, secretos ni direcciones IP.
CREATE TABLE eventos_seguridad (
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
  CONSTRAINT fk_evento_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_panaderia FOREIGN KEY (panaderia_id) REFERENCES panaderias (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_evento_actor FOREIGN KEY (actor_id) REFERENCES usuarios (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_evento_restablecimiento CHECK (
       (tipo IN ('restablecimiento_solicitado','restablecimiento_propio_solicitado','restablecimiento_activado',
                 'restablecimiento_fallido','restablecimiento_usado','restablecimiento_invalidado')
        AND restablecimiento_id IS NOT NULL)
    OR (tipo IN ('reconfirmacion_fallida','email_cambiado','emergencia_local') AND restablecimiento_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SQL 006: red colaborativa. Las parejas las crea la aplicación (red.operaciones.js); no hay semilla.
CREATE TABLE red_parejas (
  panaderia_menor_id INT NOT NULL,
  panaderia_mayor_id INT NOT NULL,
  pendientes TINYINT UNSIGNED NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (panaderia_menor_id, panaderia_mayor_id),
  KEY idx_rpar_mayor (panaderia_mayor_id),
  CONSTRAINT fk_rpar_menor FOREIGN KEY (panaderia_menor_id) REFERENCES panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_rpar_mayor FOREIGN KEY (panaderia_mayor_id) REFERENCES panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_rpar_orden CHECK (panaderia_menor_id < panaderia_mayor_id),
  CONSTRAINT chk_rpar_pendientes CHECK (pendientes <= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: parejas';

CREATE TABLE solicitudes_red (
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
  CONSTRAINT fk_sred_solicitante FOREIGN KEY (panaderia_solicitante_id) REFERENCES panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_proveedora FOREIGN KEY (panaderia_proveedora_id) REFERENCES panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_pareja FOREIGN KEY (pareja_menor_id, pareja_mayor_id) REFERENCES red_parejas (panaderia_menor_id, panaderia_mayor_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_creada_por FOREIGN KEY (creada_por) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_sred_cerrada_por FOREIGN KEY (cerrada_por) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_sred_distintas CHECK (panaderia_solicitante_id <> panaderia_proveedora_id),
  CONSTRAINT chk_sred_cierre CHECK ((estado = 'pendiente' AND cerrada_por IS NULL AND cerrada_en IS NULL)
    OR (estado <> 'pendiente' AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL)),
  CONSTRAINT chk_sred_motivo CHECK (motivo_rechazo IS NULL OR (estado = 'rechazada' AND CHAR_LENGTH(TRIM(motivo_rechazo)) > 0)),
  CONSTRAINT chk_sred_nota CHECK (nota IS NULL OR CHAR_LENGTH(TRIM(nota)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: solicitudes';

CREATE TABLE solicitudes_red_detalle (
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
  CONSTRAINT fk_dred_solicitud_solicitante FOREIGN KEY (solicitud_id, panaderia_solicitante_id) REFERENCES solicitudes_red (id, panaderia_solicitante_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_solicitud_proveedora FOREIGN KEY (solicitud_id, panaderia_proveedora_id) REFERENCES solicitudes_red (id, panaderia_proveedora_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_destino FOREIGN KEY (materia_prima_destino_id, panaderia_solicitante_id) REFERENCES materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_dred_origen FOREIGN KEY (materia_prima_origen_id, panaderia_proveedora_id) REFERENCES materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_dred_linea CHECK (linea BETWEEN 1 AND 20),
  CONSTRAINT chk_dred_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_dred_textos CHECK (CHAR_LENGTH(TRIM(nombre_solicitado)) > 0 AND CHAR_LENGTH(TRIM(unidad_medida)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: detalle';

CREATE TABLE movimientos_red (
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
  CONSTRAINT fk_mred_detalle FOREIGN KEY (detalle_id) REFERENCES solicitudes_red_detalle (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_salida FOREIGN KEY (detalle_id, salida_materia_id, salida_panaderia_id, salida_cantidad)
    REFERENCES solicitudes_red_detalle (id, materia_prima_origen_id, panaderia_proveedora_id, cantidad) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_entrada FOREIGN KEY (detalle_id, entrada_materia_id, entrada_panaderia_id, entrada_cantidad)
    REFERENCES solicitudes_red_detalle (id, materia_prima_destino_id, panaderia_solicitante_id, cantidad) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_materia FOREIGN KEY (materia_prima_id, panaderia_id) REFERENCES materia_prima (id, panaderia_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_mred_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_mred_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_mred_saldos CHECK (saldo_anterior >= 0 AND saldo_posterior >= 0 AND (
    (tipo = 'salida' AND saldo_posterior = saldo_anterior - cantidad)
    OR (tipo = 'entrada' AND saldo_posterior = saldo_anterior + cantidad)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: movimientos';

CREATE TABLE eventos_red (
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
  CONSTRAINT fk_ered_solicitante FOREIGN KEY (solicitud_id, solicitante_id) REFERENCES solicitudes_red (id, panaderia_solicitante_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_proveedora FOREIGN KEY (solicitud_id, proveedora_id) REFERENCES solicitudes_red (id, panaderia_proveedora_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_panaderia FOREIGN KEY (panaderia_id) REFERENCES panaderias (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ered_actor FOREIGN KEY (actor_id) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_ered_lado CHECK ((tipo IN ('creada', 'cancelada') AND lado = 'solicitante')
    OR (tipo IN ('aceptada', 'rechazada') AND lado = 'proveedora')),
  CONSTRAINT chk_ered_detalle CHECK (detalle IS NULL OR CHAR_LENGTH(TRIM(detalle)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='SQL006 red colaborativa: eventos';

-- ======================================================= 3. Datos iniciales: SOLO los roles fijos
-- Identificadores fijos de src/config/roles.js. Nada más se inserta aquí.
INSERT INTO roles (id, nombre, estado, createdAt, updatedAt) VALUES
  (1, 'administrador', 1, NOW(), NOW()),
  (2, 'panadero', 1, NOW(), NOW()),
  (3, 'gerente', 1, NOW(), NOW());

-- ======================================================= 4. Verificación posterior
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_NAME IN ('roles', 'usuarios', 'panaderias',
  'materia_prima', 'productos', 'ventas', 'detalle_ventas', 'receta_producto', 'orden_produccion', 'insumo_usado',
  'restablecimientos_contrasena', 'eventos_seguridad', 'red_parejas', 'solicitudes_red', 'solicitudes_red_detalle',
  'movimientos_red', 'eventos_red')) = 17
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) = 17,
  '[]', 'ABORTAR: no estan exactamente las 17 tablas esperadas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()) = 41,
  '[]', 'ABORTAR: no hay exactamente 41 claves foraneas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES') = 32
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_TYPE = 'CHECK') = 32, '[]', 'ABORTAR: no hay exactamente 32 CHECK aplicados'));
DO JSON_TYPE(IF((SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'usuarios' AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY') = 1,
  '[]', 'ABORTAR: usuarios debe tener un solo indice unico (email)'));
DO JSON_TYPE(IF((SELECT GROUP_CONCAT(CONCAT(id, ':', nombre, ':', estado) ORDER BY id SEPARATOR ',') FROM roles)
  = '1:administrador:1,2:panadero:1,3:gerente:1', '[]', 'ABORTAR: roles inesperados'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM usuarios) + (SELECT COUNT(*) FROM panaderias) + (SELECT COUNT(*) FROM materia_prima)
  + (SELECT COUNT(*) FROM productos) + (SELECT COUNT(*) FROM ventas) + (SELECT COUNT(*) FROM detalle_ventas)
  + (SELECT COUNT(*) FROM receta_producto) + (SELECT COUNT(*) FROM orden_produccion) + (SELECT COUNT(*) FROM insumo_usado)
  + (SELECT COUNT(*) FROM restablecimientos_contrasena) + (SELECT COUNT(*) FROM eventos_seguridad)
  + (SELECT COUNT(*) FROM red_parejas) + (SELECT COUNT(*) FROM solicitudes_red) + (SELECT COUNT(*) FROM solicitudes_red_detalle)
  + (SELECT COUNT(*) FROM movimientos_red) + (SELECT COUNT(*) FROM eventos_red) = 0,
  '[]', 'ABORTAR: hay datos fuera de roles'));
SELECT DATABASE() AS base, 'ESQUEMA INSTALADO: 17 tablas, 41 claves foraneas, 32 CHECK, 3 roles' AS resultado;
