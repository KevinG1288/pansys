-- =====================================================================================
-- Pansys - INSTALACIÓN LIMPIA, paso 4 de 4: verificación (SOLO LECTURA)
-- =====================================================================================
-- Comprueba el resultado de 01 + 02 sobre la base ACTUAL de la conexión, antes de abrir el servicio.
-- Solo SELECT / DO: no modifica nada. Basta una cuenta con SELECT sobre la base (p. ej. la de la
-- aplicación). Exige la identidad ESPERADA del servidor en @pansys_uuid, @pansys_puerto y
-- @pansys_datadir (sin valores fijos aquí). Forma recomendada:
--   node database/instalacion/ejecutar_sql.js --parametros=<JSON> --script=04_verificar.sql --cuenta=aplicacion
-- (alternativa con el cliente mysql: la misma orden cmd /c ... --init-command=... que en 01_esquema.sql).
-- Una compuerta falsa da ERROR 3141 (en 8.0.44 sin el texto «ABORTAR» en el mensaje: identifíquela
-- por la línea, o con ejecutar_sql.js, que muestra su texto) y se detiene.
-- Nunca muestra contraseñas ni hashes: solo si tienen formato bcrypt y si son distintos.
-- Pensado para el momento de la instalación: con la aplicación ya en uso, la compuerta «sin datos de
-- operación» fallará (es lo esperado) y el resto de comprobaciones siguen valiendo.
-- =====================================================================================

-- ======================================================= 1. Esquema
DO JSON_TYPE(IF(@pansys_uuid IS NOT NULL AND @pansys_puerto IS NOT NULL AND @pansys_datadir IS NOT NULL
  AND CAST(@@server_uuid AS BINARY) = CAST(@pansys_uuid AS BINARY) AND @@port = @pansys_puerto
  AND CAST(@@datadir AS BINARY) = CAST(@pansys_datadir AS BINARY),
  '[]', 'ABORTAR: identidad del servidor no verificada (server_uuid, puerto o datadir distintos o sin definir)'));
DO JSON_TYPE(IF(DATABASE() IS NOT NULL AND LOWER(DATABASE()) <> 'pansys_test', '[]', 'ABORTAR: base no seleccionada o de pruebas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_0900_ai_ci'
  AND TABLE_NAME IN ('roles', 'usuarios', 'panaderias', 'materia_prima', 'productos', 'ventas', 'detalle_ventas',
  'receta_producto', 'orden_produccion', 'insumo_usado', 'restablecimientos_contrasena', 'eventos_seguridad',
  'red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red')) = 17
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()) = 17,
  '[]', 'ABORTAR: no estan exactamente las 17 tablas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()) = 41
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES') = 32,
  '[]', 'ABORTAR: no hay 41 claves foraneas y 32 CHECK aplicados'));
DO JSON_TYPE(IF((SELECT CONCAT_WS('|', UPDATE_RULE, DELETE_RULE, REFERENCED_TABLE_NAME) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND CONSTRAINT_NAME = 'usuarios_ibfk_4') = 'CASCADE|RESTRICT|panaderias'
  AND (SELECT CONCAT_WS('|', UPDATE_RULE, DELETE_RULE, REFERENCED_TABLE_NAME) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'panaderias' AND CONSTRAINT_NAME = 'panaderias_ibfk_1') = 'CASCADE|CASCADE|usuarios',
  '[]', 'ABORTAR: el ciclo usuarios <-> panaderias no tiene las claves esperadas'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (
     (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO')
  OR (TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO')
  OR (TABLE_NAME = 'materia_prima' AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario') AND COLUMN_TYPE = 'decimal(12,4)' AND IS_NULLABLE = 'NO')
  OR (TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad' AND COLUMN_TYPE = 'varchar(100)' AND IS_NULLABLE = 'YES'))) = 6,
  '[]', 'ABORTAR: columnas de 003, 004 o 006 con tipo inesperado'));
DO JSON_TYPE(IF((SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'usuarios' AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY') = 1,
  '[]', 'ABORTAR: usuarios debe tener un solo indice unico (email)'));

-- ======================================================= 2. Datos iniciales
DO JSON_TYPE(IF((SELECT GROUP_CONCAT(CONCAT(id, ':', nombre, ':', estado) ORDER BY id SEPARATOR ',') FROM roles)
  = '1:administrador:1,2:panadero:1,3:gerente:1', '[]', 'ABORTAR: roles inesperados'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM panaderias) = 2 AND (SELECT COUNT(*) FROM usuarios) = 2
  AND (SELECT COUNT(*) FROM usuarios WHERE rol_id = 1 AND estado = 1 AND version_sesion = 0) = 2,
  '[]', 'ABORTAR: no hay exactamente 2 panaderias y 2 administradores activos'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM usuarios u JOIN panaderias p ON p.id = u.panaderia_id AND p.usuario_id = u.id) = 2
  AND (SELECT COUNT(DISTINCT panaderia_id) FROM usuarios) = 2,
  '[]', 'ABORTAR: cada administrador debe pertenecer a la panaderia de la que es propietario'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM usuarios WHERE REGEXP_LIKE(contrasena, '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$', 'c')) = 2
  AND (SELECT COUNT(DISTINCT contrasena) FROM usuarios) = 2,
  '[]', 'ABORTAR: las contrasenas no son dos hashes bcrypt distintos'));
DO JSON_TYPE(IF((SELECT COUNT(*) FROM usuarios WHERE email LIKE '%@pansys.test' OR email LIKE '%.invalid' OR email LIKE '%ejemplo%') = 0
  AND (SELECT COUNT(*) FROM panaderias WHERE nombre LIKE '%CAMBIAR%' OR nombre LIKE '%Prueba%' OR localidad IS NULL) = 0,
  '[]', 'ABORTAR: quedan valores de ejemplo, de prueba o localidades vacias'));

-- ======================================================= 3. Sin datos de operación (solo al instalar)
DO JSON_TYPE(IF((SELECT COUNT(*) FROM materia_prima) + (SELECT COUNT(*) FROM productos) + (SELECT COUNT(*) FROM ventas)
  + (SELECT COUNT(*) FROM detalle_ventas) + (SELECT COUNT(*) FROM receta_producto) + (SELECT COUNT(*) FROM orden_produccion)
  + (SELECT COUNT(*) FROM insumo_usado) + (SELECT COUNT(*) FROM restablecimientos_contrasena) + (SELECT COUNT(*) FROM eventos_seguridad)
  + (SELECT COUNT(*) FROM red_parejas) + (SELECT COUNT(*) FROM solicitudes_red) + (SELECT COUNT(*) FROM solicitudes_red_detalle)
  + (SELECT COUNT(*) FROM movimientos_red) + (SELECT COUNT(*) FROM eventos_red) = 0,
  '[]', 'ABORTAR: hay datos de operacion (normal si la aplicacion ya esta en uso)'));

-- ======================================================= 4. Resumen (sin secretos)
SELECT DATABASE() AS base, @@server_uuid AS servidor, VERSION() AS mysql;
SELECT p.id, p.nombre, p.localidad, p.en_red, u.id AS administrador_id, u.email AS administrador
FROM panaderias p JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.id;
SELECT 'VERIFICACION SUPERADA' AS resultado;
