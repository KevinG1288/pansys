-- =====================================================================================
-- Pansys - Base de datos de PRUEBAS (pansys_test)
-- =====================================================================================
-- Generado a partir de SHOW CREATE TABLE de pansys_db (esquema tras 001 y 002), sin datos.
-- Ejecutar manualmente en MySQL Workbench. Solo crea y usa pansys_test; no toca pansys_db.
--
-- Si pansys_test ya existe, CREATE DATABASE falla a propósito. Para recrearla desde cero,
-- ejecute antes (SOLO sobre la base de pruebas):  DROP DATABASE pansys_test;
--
-- Usuarios de prueba: su contraseña es '!' (no es un hash bcrypt), así que NO pueden
-- iniciar sesión. Las pruebas firman sus propios tokens con el JWT_SECRET local.
-- =====================================================================================

CREATE DATABASE pansys_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE pansys_test;

-- usuarios y panaderias se referencian mutuamente: se desactiva la verificación de
-- claves foráneas solo mientras se crean las tablas.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `contrasena` varchar(255) NOT NULL,
  `rol_id` int NOT NULL,
  `panaderia_id` int DEFAULT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `email_2` (`email`),
  UNIQUE KEY `email_3` (`email`),
  UNIQUE KEY `email_4` (`email`),
  UNIQUE KEY `email_5` (`email`),
  UNIQUE KEY `email_6` (`email`),
  UNIQUE KEY `email_7` (`email`),
  UNIQUE KEY `email_8` (`email`),
  UNIQUE KEY `email_9` (`email`),
  UNIQUE KEY `email_10` (`email`),
  UNIQUE KEY `email_11` (`email`),
  UNIQUE KEY `email_12` (`email`),
  UNIQUE KEY `email_13` (`email`),
  UNIQUE KEY `email_14` (`email`),
  UNIQUE KEY `email_15` (`email`),
  UNIQUE KEY `email_16` (`email`),
  UNIQUE KEY `email_17` (`email`),
  UNIQUE KEY `email_18` (`email`),
  UNIQUE KEY `email_19` (`email`),
  UNIQUE KEY `email_20` (`email`),
  UNIQUE KEY `email_21` (`email`),
  UNIQUE KEY `email_22` (`email`),
  UNIQUE KEY `email_23` (`email`),
  UNIQUE KEY `email_24` (`email`),
  UNIQUE KEY `email_25` (`email`),
  UNIQUE KEY `email_26` (`email`),
  UNIQUE KEY `email_27` (`email`),
  UNIQUE KEY `email_28` (`email`),
  UNIQUE KEY `email_29` (`email`),
  UNIQUE KEY `email_30` (`email`),
  UNIQUE KEY `email_31` (`email`),
  UNIQUE KEY `email_32` (`email`),
  UNIQUE KEY `email_33` (`email`),
  UNIQUE KEY `email_34` (`email`),
  UNIQUE KEY `email_35` (`email`),
  UNIQUE KEY `email_36` (`email`),
  UNIQUE KEY `email_37` (`email`),
  UNIQUE KEY `email_38` (`email`),
  UNIQUE KEY `email_39` (`email`),
  UNIQUE KEY `email_40` (`email`),
  UNIQUE KEY `email_41` (`email`),
  UNIQUE KEY `email_42` (`email`),
  UNIQUE KEY `email_43` (`email`),
  UNIQUE KEY `email_44` (`email`),
  UNIQUE KEY `email_45` (`email`),
  UNIQUE KEY `email_46` (`email`),
  UNIQUE KEY `email_47` (`email`),
  UNIQUE KEY `email_48` (`email`),
  UNIQUE KEY `email_49` (`email`),
  UNIQUE KEY `email_50` (`email`),
  UNIQUE KEY `email_51` (`email`),
  UNIQUE KEY `email_52` (`email`),
  UNIQUE KEY `email_53` (`email`),
  UNIQUE KEY `email_54` (`email`),
  UNIQUE KEY `email_55` (`email`),
  UNIQUE KEY `email_56` (`email`),
  UNIQUE KEY `email_57` (`email`),
  UNIQUE KEY `email_58` (`email`),
  UNIQUE KEY `email_59` (`email`),
  KEY `rol_id` (`rol_id`),
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `usuarios_ibfk_3` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `usuarios_ibfk_4` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `panaderias` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `direccion` varchar(255) NOT NULL,
  `telefono` varchar(255) DEFAULT NULL,
  `en_red` tinyint(1) DEFAULT '0',
  `usuario_id` int NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `panaderias_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `materia_prima` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `unidad_medida` varchar(255) NOT NULL,
  `cantidad_disponible` float DEFAULT '0',
  `stock_minimo` float DEFAULT '0',
  `precio_unitario` float DEFAULT '0',
  `panaderia_id` int NOT NULL,
  `estado` tinyint(1) DEFAULT '1',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `panaderia_id` (`panaderia_id`),
  CONSTRAINT `materia_prima_ibfk_1` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
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

SET FOREIGN_KEY_CHECKS = 1;

-- ============ Datos mínimos de prueba ============
INSERT INTO roles (id, nombre, estado, createdAt, updatedAt) VALUES
  (1, 'administrador', 1, NOW(), NOW()),
  (2, 'panadero', 1, NOW(), NOW()),
  (3, 'gerente', 1, NOW(), NOW());

INSERT INTO usuarios (id, email, contrasena, rol_id, panaderia_id, estado, createdAt, updatedAt) VALUES
  (1, 'admin@pansys.test', '!', 1, NULL, 1, NOW(), NOW());

INSERT INTO panaderias (id, nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES
  (1, 'Panadería Prueba Uno', 'Dirección de prueba 1', NULL, 1, 1, NOW(), NOW()),
  (2, 'Panadería Prueba Dos', 'Dirección de prueba 2', NULL, 1, 1, NOW(), NOW());

INSERT INTO usuarios (id, email, contrasena, rol_id, panaderia_id, estado, createdAt, updatedAt) VALUES
  (2, 'panadero1@pansys.test', '!', 2, 1, 1, NOW(), NOW()),
  (3, 'panadero2@pansys.test', '!', 2, 2, 1, NOW(), NOW()),
  (4, 'gerente1@pansys.test',  '!', 3, 1, 1, NOW(), NOW());

-- ============ Verificación (solo lectura) ============
-- Esperado: 10 tablas, 3 roles, 4 usuarios, 2 panaderías.
SELECT DATABASE() AS base_actual;
SELECT COUNT(*) AS tablas FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test';
SELECT (SELECT COUNT(*) FROM roles) AS roles, (SELECT COUNT(*) FROM usuarios) AS usuarios,
       (SELECT COUNT(*) FROM panaderias) AS panaderias;
