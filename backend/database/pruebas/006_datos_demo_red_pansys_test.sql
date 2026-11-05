-- =====================================================================================
-- Pansys - 006 (base de PRUEBAS): datos de demostración de la red colaborativa
-- =====================================================================================
-- Prepara pansys_test para demostrar la red entre las panaderías 1 y 2:
--   * localidad de las dos panaderías y en_red = 1;
--   * la cuenta administradora de la panadería 2 (admin2@pansys.test), que la semilla no crea;
--   * 5 materias primas en cada panadería, 4 de ellas con el MISMO nombre y la MISMA unidad en
--     las dos (la aceptación exige unidades idénticas), con poco stock en la 1 y stock suficiente
--     en la 2.
-- NO crea solicitudes, líneas, movimientos, eventos ni parejas: las tablas de la red quedan
-- vacías y la demostración las rellena desde la aplicación. No escribe en columnas generadas.
--
-- TIPO: datos de la base de PRUEBAS. Nunca se aplica a pansys_db: todas las sentencias nombran
--   pansys_test y la primera compuerta exige DATABASE() = 'pansys_test'.
-- ESTADO: NO APLICADO. Su ejecución requiere una autorización expresa (etapa E0b).
-- REQUISITOS: 006_red_colaborativa_pansys_test.sql YA aplicado y verificado; las cuentas 1, 2
--   y 3 de la semilla (crear_pansys_test.sql) en sus panaderías; ninguna otra conexión.
--
-- CONTRASEÑAS: la cuenta nueva se crea con contraseña '!' (no es un hash bcrypt: no puede
--   iniciar sesión), igual que la semilla. Su contraseña se fija después desde la aplicación con
--   «¿Olvidaste tu contraseña?» (correo de desarrollo en Mailpit). Este archivo no contiene ni
--   pide contraseñas.
--
-- CÓMO EJECUTAR: el archivo COMPLETO en UNA invocación del cliente mysql por lotes, sin --force,
--   desde cmd.exe (ver 006_INSTRUCCIONES_pansys_test.md). Las escrituras van en UNA transacción:
--   si una compuerta falla (error 3141) el cliente se detiene, la conexión se cierra y MySQL
--   deshace la transacción sin confirmar; no queda nada a medias.
-- DESHACER: tras el COMMIT, la vuelta atrás es restaurar el respaldo previo a E0b. La reversión
--   del 006 aborta a propósito si hay localidades rellenadas.
-- =====================================================================================

SET SESSION lock_wait_timeout = 10;
SET SESSION innodb_lock_wait_timeout = 10;

-- ======================================================= 1. Compuertas previas (solo lectura)
DO JSON_TYPE(IF(DATABASE() = 'pansys_test', '[]', 'ABORTAR: la base actual no es pansys_test'));
DO JSON_TYPE(IF(VERSION() LIKE '8.0.%', '[]', 'ABORTAR: se requiere MySQL de la serie 8.0'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.PROCESSLIST
  WHERE ID <> CONNECTION_ID() AND USER NOT IN ('event_scheduler', 'system user')) = 0,
  '[]', 'ABORTAR: hay otras conexiones de cliente en el servidor (detenga la aplicación y los clientes)'));

-- El SQL 006 está aplicado: las 5 tablas marcadas, version_fila y localidad
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test'
  AND TABLE_NAME IN ('red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')
  AND TABLE_COMMENT LIKE 'SQL006%') = 5, '[]', 'ABORTAR: el SQL 006 no está aplicado (faltan tablas de la red)'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test'
  AND ((TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila') OR (TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad'))) = 2,
  '[]', 'ABORTAR: el SQL 006 no está aplicado (faltan version_fila o localidad)'));

-- Las tablas de la red están vacías
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.red_parejas) + (SELECT COUNT(*) FROM pansys_test.solicitudes_red)
  + (SELECT COUNT(*) FROM pansys_test.solicitudes_red_detalle) + (SELECT COUNT(*) FROM pansys_test.movimientos_red)
  + (SELECT COUNT(*) FROM pansys_test.eventos_red) = 0, '[]', 'ABORTAR: las tablas de la red no están vacías'));

-- Roles y panaderías de la semilla; localidad todavía sin rellenar (estos datos no se aplicaron antes)
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.roles WHERE (id, nombre) IN ((1, 'administrador'), (2, 'panadero'))) = 2,
  '[]', 'ABORTAR: faltan los roles administrador (1) y panadero (2)'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.panaderias WHERE id IN (1, 2) AND localidad IS NULL) = 2,
  '[]', 'ABORTAR: faltan las panaderías 1 y 2 o ya tienen localidad (¿datos de demostración ya aplicados?)'));

-- Cuentas de la semilla: administradora y panadero de la 1, panadero de la 2, activas
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.usuarios WHERE estado = 1 AND (
    (email = 'admin@pansys.test' AND rol_id = 1 AND panaderia_id = 1)
    OR (email = 'panadero1@pansys.test' AND rol_id = 2 AND panaderia_id = 1)
    OR (email = 'panadero2@pansys.test' AND rol_id = 2 AND panaderia_id = 2))) = 3,
  '[]', 'ABORTAR: las cuentas 1-3 de la semilla no están activas en sus panaderías'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.usuarios WHERE email = 'admin2@pansys.test') = 0,
  '[]', 'ABORTAR: admin2@pansys.test ya existe'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.usuarios WHERE rol_id = 1 AND panaderia_id = 2) = 0,
  '[]', 'ABORTAR: la panadería 2 ya tiene administrador'));

-- Ninguna materia de la demostración existe ya en las panaderías 1 y 2 (activa o no)
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.materia_prima WHERE panaderia_id IN (1, 2)
  AND nombre IN ('Harina de trigo', 'Azúcar', 'Mantequilla', 'Levadura fresca', 'Huevos', 'Leche entera')) = 0,
  '[]', 'ABORTAR: ya existen materias con los nombres de la demostración'));

-- ======================================================= 2. Escrituras (UNA transacción)
START TRANSACTION;

UPDATE pansys_test.panaderias SET localidad = 'Kennedy Central', en_red = 1, updatedAt = NOW()
  WHERE id = 1 AND localidad IS NULL;
UPDATE pansys_test.panaderias SET localidad = 'Patio Bonito', en_red = 1, updatedAt = NOW()
  WHERE id = 2 AND localidad IS NULL;

-- Administradora de la panadería 2 (contraseña inutilizable '!', ver cabecera)
INSERT INTO pansys_test.usuarios (email, contrasena, rol_id, panaderia_id, estado, createdAt, updatedAt) VALUES
  ('admin2@pansys.test', '!', 1, 2, 1, NOW(), NOW());

-- Panadería 1 (solicitante en la demostración): stock bajo en harina, azúcar, mantequilla y levadura
INSERT INTO pansys_test.materia_prima (nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario, panaderia_id, estado, createdAt, updatedAt) VALUES
  ('Harina de trigo', 'kg', 6.0000, 25.0000, 3200.0000, 1, 1, NOW(), NOW()),
  ('Azúcar', 'kg', 4.5000, 10.0000, 4100.0000, 1, 1, NOW(), NOW()),
  ('Mantequilla', 'kg', 1.2500, 3.0000, 18500.0000, 1, 1, NOW(), NOW()),
  ('Levadura fresca', 'g', 250.0000, 500.0000, 28.0000, 1, 1, NOW(), NOW()),
  ('Huevos', 'unidad', 90.0000, 60.0000, 600.0000, 1, 1, NOW(), NOW());

-- Panadería 2 (proveedora en la demostración): stock suficiente con las mismas unidades
INSERT INTO pansys_test.materia_prima (nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario, panaderia_id, estado, createdAt, updatedAt) VALUES
  ('Harina de trigo', 'kg', 80.0000, 20.0000, 3100.0000, 2, 1, NOW(), NOW()),
  ('Azúcar', 'kg', 35.0000, 10.0000, 4000.0000, 2, 1, NOW(), NOW()),
  ('Mantequilla', 'kg', 12.0000, 3.0000, 18000.0000, 2, 1, NOW(), NOW()),
  ('Levadura fresca', 'g', 4000.0000, 500.0000, 27.0000, 2, 1, NOW(), NOW()),
  ('Leche entera', 'l', 40.0000, 10.0000, 4200.0000, 2, 1, NOW(), NOW());

-- ======================================================= 3. Verificación antes del COMMIT
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.panaderias WHERE en_red = 1
  AND ((id = 1 AND localidad = 'Kennedy Central') OR (id = 2 AND localidad = 'Patio Bonito'))) = 2,
  '[]', 'ABORTAR: localidad o en_red de las panaderías 1 y 2 no quedaron como se esperaba'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.usuarios WHERE email = 'admin2@pansys.test'
  AND rol_id = 1 AND panaderia_id = 2 AND estado = 1 AND contrasena = '!' AND version_sesion = 0) = 1,
  '[]', 'ABORTAR: la cuenta admin2@pansys.test no quedó como se esperaba'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.materia_prima WHERE panaderia_id IN (1, 2) AND estado = 1 AND version_fila = 0
  AND nombre IN ('Harina de trigo', 'Azúcar', 'Mantequilla', 'Levadura fresca', 'Huevos', 'Leche entera')) = 10,
  '[]', 'ABORTAR: no hay exactamente 10 materias de la demostración activas con version_fila 0'));
-- 4 parejas compatibles: mismo nombre y misma unidad en las dos panaderías
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.materia_prima a JOIN pansys_test.materia_prima b
  ON b.nombre = a.nombre AND b.unidad_medida = a.unidad_medida AND b.panaderia_id = 2
  WHERE a.panaderia_id = 1 AND a.nombre IN ('Harina de trigo', 'Azúcar', 'Mantequilla', 'Levadura fresca')) = 4,
  '[]', 'ABORTAR: no hay 4 materias compatibles (nombre y unidad) entre las panaderías 1 y 2'));
-- Codificación: 'Azúcar' son 6 caracteres y 7 bytes en utf8mb4 (si la conexión no fuera utf8mb4, se aborta)
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.materia_prima WHERE panaderia_id IN (1, 2)
  AND nombre = 'Azúcar' AND CHAR_LENGTH(nombre) = 6 AND LENGTH(nombre) = 7) = 2,
  '[]', 'ABORTAR: el texto no llegó en utf8mb4 (use --default-character-set=utf8mb4)'));
-- La red sigue vacía
DO JSON_TYPE(IF((SELECT COUNT(*) FROM pansys_test.red_parejas) + (SELECT COUNT(*) FROM pansys_test.solicitudes_red)
  + (SELECT COUNT(*) FROM pansys_test.solicitudes_red_detalle) + (SELECT COUNT(*) FROM pansys_test.movimientos_red)
  + (SELECT COUNT(*) FROM pansys_test.eventos_red) = 0, '[]', 'ABORTAR: las tablas de la red no están vacías'));

COMMIT;

-- ======================================================= 4. Resumen (solo lectura)
SELECT 'DATOS_DEMO_APLICADOS' AS fase, NOW() AS hora;
SELECT id, nombre, localidad, en_red FROM pansys_test.panaderias WHERE id IN (1, 2) ORDER BY id;
SELECT id, email, rol_id, panaderia_id, estado FROM pansys_test.usuarios
  WHERE email IN ('admin@pansys.test', 'panadero1@pansys.test', 'admin2@pansys.test', 'panadero2@pansys.test') ORDER BY panaderia_id, rol_id;
SELECT panaderia_id, nombre, unidad_medida, cantidad_disponible, stock_minimo, version_fila FROM pansys_test.materia_prima
  WHERE panaderia_id IN (1, 2) AND nombre IN ('Harina de trigo', 'Azúcar', 'Mantequilla', 'Levadura fresca', 'Huevos', 'Leche entera')
  ORDER BY nombre, panaderia_id;
