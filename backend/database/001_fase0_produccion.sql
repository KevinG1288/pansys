-- Pansys - Fase 0 (aislamiento por panadería) y tablas del módulo de Producción
-- Ejecutar manualmente en MySQL Workbench UNA sola vez sobre pansys_db.
-- Las sentencias DDL de MySQL no se pueden deshacer con ROLLBACK; ver el bloque de reversión al final.

USE pansys_db;

-- ============ 1. Usuarios: panadería asignada (NULL = administrador general) ============
ALTER TABLE usuarios
  ADD COLUMN panaderia_id INT NULL AFTER rol_id,
  ADD CONSTRAINT fk_usuarios_panaderia FOREIGN KEY (panaderia_id)
    REFERENCES panaderias(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ 2. Desactivar roles duplicados (solo si nadie los usa) ============
UPDATE roles SET estado = 0
WHERE id IN (4, 5, 6) AND id NOT IN (SELECT rol_id FROM usuarios);

-- ============ 3. Receta: insumos por UNA unidad de producto ============
CREATE TABLE receta_producto (
  id INT AUTO_INCREMENT PRIMARY KEY,
  producto_id INT NOT NULL,
  materia_prima_id INT NOT NULL,
  cantidad_por_unidad DECIMAL(12,4) NOT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_receta (producto_id, materia_prima_id),
  CONSTRAINT fk_receta_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_receta_materia FOREIGN KEY (materia_prima_id) REFERENCES materia_prima(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_receta_cantidad CHECK (cantidad_por_unidad > 0)
) ENGINE=InnoDB;

-- ============ 4. Orden de producción (un producto por orden) ============
CREATE TABLE orden_produccion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  panaderia_id INT NOT NULL,
  producto_id INT NOT NULL,
  empleado_id INT NOT NULL,
  fecha DATE NOT NULL,
  cantidad_planificada INT NOT NULL,
  cantidad_producida INT NULL,
  estado ENUM('en_proceso','finalizada','cancelada') NOT NULL DEFAULT 'en_proceso',
  costo_insumos DECIMAL(12,2) NOT NULL DEFAULT 0,
  observaciones VARCHAR(500) NULL,
  motivo_cancelacion VARCHAR(500) NULL,
  insumos_devueltos TINYINT(1) NOT NULL DEFAULT 0,
  fecha_finalizacion DATETIME NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  KEY idx_orden_panaderia_estado (panaderia_id, estado),
  CONSTRAINT fk_orden_panaderia FOREIGN KEY (panaderia_id) REFERENCES panaderias(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orden_producto  FOREIGN KEY (producto_id)  REFERENCES productos(id)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orden_empleado  FOREIGN KEY (empleado_id)  REFERENCES usuarios(id)   ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_orden_planificada CHECK (cantidad_planificada > 0),
  CONSTRAINT chk_orden_producida  CHECK (cantidad_producida IS NULL OR cantidad_producida >= 0)
) ENGINE=InnoDB;

-- ============ 5. Insumos consumidos por orden ============
CREATE TABLE insumo_usado (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orden_id INT NOT NULL,
  materia_prima_id INT NOT NULL,
  cantidad_usada DECIMAL(12,4) NOT NULL,
  costo DECIMAL(12,2) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_insumo_orden (orden_id, materia_prima_id),
  CONSTRAINT fk_insumo_orden   FOREIGN KEY (orden_id)         REFERENCES orden_produccion(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_insumo_materia FOREIGN KEY (materia_prima_id) REFERENCES materia_prima(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_insumo_cantidad CHECK (cantidad_usada > 0)
) ENGINE=InnoDB;

-- ============ 6. Seed: segunda panadería (creada por el administrador general) ============
SET @admin_id = (SELECT MIN(id) FROM usuarios WHERE rol_id = 1);
INSERT INTO panaderias (nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt)
SELECT 'Panadería La Espiga Dorada', 'Carrera 78 # 42-35, Kennedy', NULL, true, @admin_id, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM panaderias WHERE nombre = 'Panadería La Espiga Dorada');

-- ============ Verificación (solo lectura) ============
-- SHOW COLUMNS FROM usuarios LIKE 'panaderia_id';
-- SELECT id, nombre, estado FROM roles;
-- SHOW TABLES;
-- SELECT id, nombre, en_red FROM panaderias;

-- ============ Reversión (solo si fuera necesario) ============
-- DROP TABLE IF EXISTS insumo_usado, orden_produccion, receta_producto;
-- ALTER TABLE usuarios DROP FOREIGN KEY fk_usuarios_panaderia, DROP COLUMN panaderia_id;
-- UPDATE roles SET estado = 1 WHERE id IN (4, 5, 6);
-- DELETE FROM panaderias WHERE nombre = 'Panadería La Espiga Dorada';
