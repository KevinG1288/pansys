-- =====================================================================================
-- Pansys - 003 (base de PRUEBAS): materia_prima a DECIMAL(12,4), igual que pansys_db
-- =====================================================================================
-- TIPO: migración de una base de PRUEBAS existente (y registro de lo aplicado en pansys_test).
--
-- ESTADO: YA APLICADO en pansys_test el 2026-10-20, con todas las verificaciones previas y
--   posteriores correctas (comparación fila por fila incluida). Hoy pansys_test ya tiene las
--   tres columnas en DECIMAL(12,4) NOT NULL DEFAULT '0.0000'.
--   NO LO VUELVA A EJECUTAR sobre pansys_test: el paso 1.3 mostraría decimal(12,4) en lugar de
--   float y el paso 1.4 ninguna diferencia (DETÉNGASE ahí).
--   Para crear una base de pruebas NUEVA no use este archivo: crear_pansys_test.sql ya crea
--   las columnas en DECIMAL(12,4). Este script solo sirve para una pansys_test creada antes
--   del 003. El registro del cambio en producción es ../003_materia_prima_decimal.sql.
--
-- Objetivo: alinear pansys_test con pansys_db, donde el SQL 003 ya se aplicó. Cambia SOLO
-- cantidad_disponible, stock_minimo y precio_unitario (tipo, nulabilidad y valor por defecto).
--
-- Definición de referencia en pansys_db (SHOW CREATE TABLE, MySQL 8.0.44):
--   `cantidad_disponible` decimal(12,4) NOT NULL DEFAULT '0.0000',
--   `stock_minimo`        decimal(12,4) NOT NULL DEFAULT '0.0000',
--   `precio_unitario`     decimal(12,4) NOT NULL DEFAULT '0.0000',
-- Definición ANTERIOR a la migración en pansys_test (la que este script espera encontrar):
--   `cantidad_disponible` float DEFAULT '0',   (admite NULL)
--   `stock_minimo`        float DEFAULT '0',   (admite NULL)
--   `precio_unitario`     float DEFAULT '0',   (admite NULL)
-- Resto de columnas (iguales en ambas bases): id int NOT NULL AUTO_INCREMENT,
--   nombre y unidad_medida varchar(255) NOT NULL (utf8mb4_0900_ai_ci), panaderia_id int
--   NOT NULL, estado tinyint(1) DEFAULT '1', createdAt y updatedAt datetime NOT NULL
--   (sin fracciones de segundo y sin ON UPDATE: el ALTER no las modifica).
--
-- -------------------------------------------------------------------------------------
-- ALCANCE Y SEGURIDAD
-- -------------------------------------------------------------------------------------
--  * Todas las sentencias que modifican algo nombran explícitamente pansys_test
--    (pansys_test.materia_prima y una tabla TEMPORAL). pansys_db solo se LEE, a través de
--    information_schema (pasos 1.2, 1.4, 1.5, 3.2 y 3.3).
--  * Ejecute el script en MySQL Workbench, BLOQUE POR BLOQUE, en la MISMA pestaña del editor
--    de principio a fin: el paso 1.8 guarda una copia de los datos en una tabla TEMPORAL que
--    solo existe en esa conexión. Si cierra la pestaña o se reconecta, la copia se pierde:
--    vuelva a empezar desde el paso 1.1.
--  * NO ejecute las pruebas del backend durante todo el proceso: borran y crean filas en
--    materia_prima y la comparación por filas dejaría de ser válida.
--  * La tabla temporal no modifica materia_prima ni ninguna tabla permanente; desaparece al
--    cerrar la conexión o con el paso 5.
--  * Se ejecutó correctamente en pansys_test el 2026-10-20. Si alguna consulta de verificación
--    diera un error, ocurriría en la sección 1, antes del ALTER: deténgase y avise.
--  * MySQL no permite usar una tabla TEMPORAL más de una vez en la misma consulta (error 1137):
--    por eso las comprobaciones de la copia (1.8) y el resumen (3.5) van en consultas separadas.
--
-- -------------------------------------------------------------------------------------
-- PRECISIÓN DE FLOAT: QUÉ CAMBIA REALMENTE AL CONVERTIR A DECIMAL(12,4)
-- -------------------------------------------------------------------------------------
--  FLOAT no guarda decimales exactos sino la fracción binaria más cercana. Por ejemplo, al
--  guardar 0.3 se almacena 0.300000011920929..., y al guardar 25000.1 se almacena
--  25000.099609375. Al leer un FLOAT, MySQL lo MUESTRA abreviado ("0.3", "25000.1"), que es
--  también lo que hoy recibe la API.
--
--  Al convertir, MySQL toma el valor binario almacenado (en doble precisión) y lo redondea a
--  4 decimales. Por eso cada valor cae en una de estas categorías (paso 1.7):
--    1 exacto:                el valor binario tiene 4 decimales o menos (9.5, 3000, 0.125).
--                             El número no cambia en absoluto.
--    2 ruido binario:         el valor binario tiene más decimales, pero redondeado a 4 da
--                             exactamente el valor mostrado (0.300000011920929 -> 0.3000).
--                             Cambia el número almacenado, pero solo en su aproximación
--                             binaria (diferencia menor que 0.00005); lo que se ve no cambia.
--    3 redondeo:              el valor MOSTRADO ya tiene más de 4 decimales (1.23456) y se
--                             redondea (1.2346). Se pierden decimales reales.
--    4 aproximación visible:  el error binario alcanza el 4.º decimal: se mostraba 25000.1 y
--                             pasará a 25000.0996. Lo que se ve SÍ cambia.
--  Solo las categorías 1 y 2 conservan el valor que hoy se ve. La conversión no conserva el
--  número binario original salvo en la categoría 1. El script no lo da por supuesto: guarda el
--  resultado previsto (1.8) y lo compara con el resultado real del ALTER (3.4 y 3.5).
--
--  Limitación: CAST(columna AS DECIMAL(65,20)) muestra el valor binario con la precisión de
--  la conversión de MySQL (doble precisión, unos 17 dígitos significativos), no su desarrollo
--  decimal completo. Basta para decidir el redondeo a 4 decimales en valores de este rango;
--  aun así, la comparación posterior con el resultado real es la que confirma cada fila.
--
-- -------------------------------------------------------------------------------------
-- QUÉ COMPROBAR
-- -------------------------------------------------------------------------------------
--  ANTES DEL ALTER (paso 2.1). Si algo no coincide, DETÉNGASE y no ejecute el ALTER:
--    1.1  base_actual = pansys_test
--    1.2  pansys_db: las tres columnas son decimal(12,4) | NO | 0.0000
--    1.3  pansys_test: las tres columnas son float | YES | 0
--    1.4  exactamente 3 filas (cantidad_disponible, stock_minimo, precio_unitario) con
--         diferencia "tipo, nulabilidad, valor por defecto"; ninguna otra
--    1.5  ninguna fila (índices, restricciones y opciones de tabla iguales)
--    1.6  disp_null = min_null = precio_null = 0 y fuera_de_rango = 0
--         (los negativos son informativos: DECIMAL(12,4) los admite, igual que pansys_db)
--    1.7  en el resumen, solo las categorías "1 exacto" o "2 ruido binario"; si aparece
--         "3 redondeo", "4 aproximación visible" o "NULL", revise el detalle y consulte
--    1.8  filas_en_copia = filas de 1.6 y diferencias_con_el_original = 0
--
--  DESPUÉS DEL ALTER:
--    3.1  pansys_test: las tres columnas son decimal(12,4) | NO | 0.0000
--    3.2  ninguna fila (columnas idénticas a pansys_db en ambos sentidos)
--    3.3  ninguna fila (índices, restricciones y opciones de tabla idénticos)
--    3.4  en cada fila: *_prevision_ok = 1 y resto_igual = 1;
--         *_igual_a_mostrado = 1 para valores de categoría 1 y 2;
--         *_igual_a_binario = 1 solo para valores de categoría 1
--    3.5  filas_antes = filas_despues; filas_que_faltan = filas_nuevas = 0;
--         filas_con_prevision_fallida = 0; filas_con_otros_campos_cambiados = 0;
--         filas_distintas_del_valor_mostrado = número de filas con categoría 3 o 4 (0 si 1.7
--         solo mostró categorías 1 y 2)
--    3.6  la huella coincide con la anotada en 1.9
--
--  * El ALTER es una única sentencia DDL atómica (InnoDB, MySQL 8): se aplican las tres
--    columnas o ninguna. Si falla (por un NULL o un valor fuera de rango en modo estricto),
--    la tabla queda exactamente como estaba.
--  * El DDL hace COMMIT implícito: no se puede deshacer con ROLLBACK (ver la sección 4).
-- =====================================================================================

USE pansys_test;

-- =====================================================================================
-- 1. VERIFICACIÓN PREVIA (solo lectura, salvo la copia TEMPORAL del paso 1.8)
-- =====================================================================================

-- 1.1 Base seleccionada. Esperado: pansys_test
SELECT DATABASE() AS base_actual;

-- 1.2 Definición de referencia en pansys_db (solo lee information_schema).
--     Esperado: decimal(12,4) | NO | 0.0000 en las tres columnas
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_db' AND TABLE_NAME = 'materia_prima'
  AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
ORDER BY ORDINAL_POSITION;

-- 1.3 Definición actual en pansys_test. Esperado: float | YES | 0 en las tres columnas
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
  AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
ORDER BY ORDINAL_POSITION;

-- 1.4 Diferencias de COLUMNAS entre pansys_test y pansys_db, en ambos sentidos: columnas que
--     faltan o sobran, y diferencias de posición, tipo, nulabilidad, valor por defecto,
--     atributos extra, juego de caracteres, intercalación, comentario o expresión generada.
--     Esperado AHORA: exactamente 3 filas, las tres columnas a migrar, con
--     "tipo, nulabilidad, valor por defecto". (La misma consulta se repite en 3.2.)
SELECT objeto, nombre, diferencia
FROM (
  SELECT 'columna' AS objeto, CONVERT(t.COLUMN_NAME USING utf8mb4) AS nombre,
         CASE WHEN d.COLUMN_NAME IS NULL THEN 'sobra en pansys_test (no existe en pansys_db)'
         ELSE CONCAT_WS(', ',
           IF(t.ORDINAL_POSITION      <=> d.ORDINAL_POSITION,      NULL, 'posición'),
           IF(t.COLUMN_TYPE           <=> d.COLUMN_TYPE,           NULL, 'tipo'),
           IF(t.IS_NULLABLE           <=> d.IS_NULLABLE,           NULL, 'nulabilidad'),
           IF(t.COLUMN_DEFAULT        <=> d.COLUMN_DEFAULT,        NULL, 'valor por defecto'),
           IF(t.EXTRA                 <=> d.EXTRA,                 NULL, 'extra'),
           IF(t.CHARACTER_SET_NAME    <=> d.CHARACTER_SET_NAME,    NULL, 'juego de caracteres'),
           IF(t.COLLATION_NAME        <=> d.COLLATION_NAME,        NULL, 'intercalación'),
           IF(t.COLUMN_COMMENT        <=> d.COLUMN_COMMENT,        NULL, 'comentario'),
           IF(t.GENERATION_EXPRESSION <=> d.GENERATION_EXPRESSION, NULL, 'expresión generada'))
         END AS diferencia
  FROM information_schema.COLUMNS t
  LEFT JOIN information_schema.COLUMNS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.COLUMN_NAME = t.COLUMN_NAME
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'columna', CONVERT(d.COLUMN_NAME USING utf8mb4), 'falta en pansys_test (existe en pansys_db)'
  FROM information_schema.COLUMNS d
  LEFT JOIN information_schema.COLUMNS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima' AND t.COLUMN_NAME = d.COLUMN_NAME
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.COLUMN_NAME IS NULL
) comparacion
WHERE diferencia <> ''
ORDER BY nombre;

-- 1.5 Diferencias de ÍNDICES, RESTRICCIONES (clave primaria, claves foráneas, CHECK) y
--     OPCIONES DE TABLA, en ambos sentidos. El esquema al que apuntan las claves foráneas es
--     distinto por diseño (pansys_test / pansys_db), así que se comparan la tabla y la
--     columna referenciadas y las reglas ON UPDATE / ON DELETE.
--     Esperado AHORA y después del ALTER: ninguna fila. (La misma consulta se repite en 3.3.)
SELECT objeto, nombre, diferencia
FROM (
  -- Índices: por nombre y posición de cada columna dentro del índice
  SELECT 'índice' AS objeto, CONVERT(CONCAT(t.INDEX_NAME, ' #', t.SEQ_IN_INDEX) USING utf8mb4) AS nombre,
         CASE WHEN d.INDEX_NAME IS NULL THEN 'sobra en pansys_test'
         ELSE CONCAT_WS(', ',
           IF(t.COLUMN_NAME <=> d.COLUMN_NAME, NULL, 'columna'),
           IF(t.NON_UNIQUE  <=> d.NON_UNIQUE,  NULL, 'unicidad'),
           IF(t.SUB_PART    <=> d.SUB_PART,    NULL, 'longitud de prefijo'),
           IF(t.INDEX_TYPE  <=> d.INDEX_TYPE,  NULL, 'tipo de índice'),
           IF(t.COLLATION   <=> d.COLLATION,   NULL, 'orden'),
           IF(t.IS_VISIBLE  <=> d.IS_VISIBLE,  NULL, 'visibilidad'),
           IF(t.EXPRESSION  <=> d.EXPRESSION,  NULL, 'expresión'))
         END AS diferencia
  FROM information_schema.STATISTICS t
  LEFT JOIN information_schema.STATISTICS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
   AND d.INDEX_NAME = t.INDEX_NAME AND d.SEQ_IN_INDEX = t.SEQ_IN_INDEX
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'índice', CONVERT(CONCAT(d.INDEX_NAME, ' #', d.SEQ_IN_INDEX) USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.STATISTICS d
  LEFT JOIN information_schema.STATISTICS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
   AND t.INDEX_NAME = d.INDEX_NAME AND t.SEQ_IN_INDEX = d.SEQ_IN_INDEX
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.INDEX_NAME IS NULL

  UNION ALL
  -- Restricciones: existencia y tipo (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
  SELECT 'restricción', CONVERT(t.CONSTRAINT_NAME USING utf8mb4),
         CASE WHEN d.CONSTRAINT_NAME IS NULL THEN 'sobra en pansys_test'
              WHEN NOT (t.CONSTRAINT_TYPE <=> d.CONSTRAINT_TYPE) THEN 'tipo'
              ELSE '' END
  FROM information_schema.TABLE_CONSTRAINTS t
  LEFT JOIN information_schema.TABLE_CONSTRAINTS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'restricción', CONVERT(d.CONSTRAINT_NAME USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.TABLE_CONSTRAINTS d
  LEFT JOIN information_schema.TABLE_CONSTRAINTS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME = d.CONSTRAINT_NAME
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME IS NULL

  UNION ALL
  -- Columnas de cada restricción (clave primaria y foráneas) y columna referenciada
  SELECT 'columna de restricción', CONVERT(CONCAT(t.CONSTRAINT_NAME, ' #', t.ORDINAL_POSITION) USING utf8mb4),
         CASE WHEN d.CONSTRAINT_NAME IS NULL THEN 'sobra en pansys_test'
         ELSE CONCAT_WS(', ',
           IF(t.COLUMN_NAME            <=> d.COLUMN_NAME,            NULL, 'columna'),
           IF(t.REFERENCED_TABLE_NAME  <=> d.REFERENCED_TABLE_NAME,  NULL, 'tabla referenciada'),
           IF(t.REFERENCED_COLUMN_NAME <=> d.REFERENCED_COLUMN_NAME, NULL, 'columna referenciada'))
         END
  FROM information_schema.KEY_COLUMN_USAGE t
  LEFT JOIN information_schema.KEY_COLUMN_USAGE d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
   AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND d.ORDINAL_POSITION = t.ORDINAL_POSITION
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'columna de restricción', CONVERT(CONCAT(d.CONSTRAINT_NAME, ' #', d.ORDINAL_POSITION) USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.KEY_COLUMN_USAGE d
  LEFT JOIN information_schema.KEY_COLUMN_USAGE t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
   AND t.CONSTRAINT_NAME = d.CONSTRAINT_NAME AND t.ORDINAL_POSITION = d.ORDINAL_POSITION
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME IS NULL

  UNION ALL
  -- Reglas de las claves foráneas (la existencia ya se compara en "restricción")
  SELECT 'clave foránea', CONVERT(t.CONSTRAINT_NAME USING utf8mb4),
         CONCAT_WS(', ',
           IF(t.REFERENCED_TABLE_NAME <=> d.REFERENCED_TABLE_NAME, NULL, 'tabla referenciada'),
           IF(t.UPDATE_RULE           <=> d.UPDATE_RULE,           NULL, 'ON UPDATE'),
           IF(t.DELETE_RULE           <=> d.DELETE_RULE,           NULL, 'ON DELETE'),
           IF(t.MATCH_OPTION          <=> d.MATCH_OPTION,          NULL, 'MATCH'))
  FROM information_schema.REFERENTIAL_CONSTRAINTS t
  JOIN information_schema.REFERENTIAL_CONSTRAINTS d
    ON d.CONSTRAINT_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME
  WHERE t.CONSTRAINT_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'

  UNION ALL
  -- Condición de las restricciones CHECK con el mismo nombre en ambas bases
  SELECT 'condición CHECK', CONVERT(tc.CONSTRAINT_NAME USING utf8mb4),
         IF(ct.CHECK_CLAUSE <=> cd.CHECK_CLAUSE, '', 'condición distinta')
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS ct
    ON ct.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND ct.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  JOIN information_schema.CHECK_CONSTRAINTS cd
    ON cd.CONSTRAINT_SCHEMA = 'pansys_db' AND cd.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = 'pansys_test' AND tc.TABLE_NAME = 'materia_prima' AND tc.CONSTRAINT_TYPE = 'CHECK'

  UNION ALL
  -- Opciones de la tabla
  SELECT 'tabla', CONVERT('materia_prima' USING utf8mb4),
         CONCAT_WS(', ',
           IF(t.ENGINE          <=> d.ENGINE,          NULL, 'motor'),
           IF(t.TABLE_COLLATION <=> d.TABLE_COLLATION, NULL, 'intercalación'),
           IF(t.ROW_FORMAT      <=> d.ROW_FORMAT,      NULL, 'formato de fila'),
           IF(t.CREATE_OPTIONS  <=> d.CREATE_OPTIONS,  NULL, 'opciones de creación'),
           IF(t.TABLE_COMMENT   <=> d.TABLE_COMMENT,   NULL, 'comentario'))
  FROM information_schema.TABLES t
  JOIN information_schema.TABLES d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
) comparacion
WHERE diferencia <> ''
ORDER BY objeto, nombre;

-- 1.6 NULL, negativos y valores fuera del rango de DECIMAL(12,4) (±99.999.999,9999).
--     El rango se evalúa sobre el valor ya redondeado a 4 decimales, que es el que se guardaría.
--     Esperado: *_null = 0 y fuera_de_rango = 0.
--     Con NOT NULL y modo estricto, un NULL o un valor fuera de rango hacen FALLAR el ALTER sin
--     cambiar nada. Los negativos NO lo impiden; se muestran porque algunas pruebas crean
--     precios negativos a propósito.
SELECT COUNT(*) AS filas,
       SUM(cantidad_disponible IS NULL) AS disp_null,
       SUM(stock_minimo IS NULL)        AS min_null,
       SUM(precio_unitario IS NULL)     AS precio_null,
       SUM(cantidad_disponible < 0)     AS disp_negativos,
       SUM(stock_minimo < 0)            AS min_negativos,
       SUM(precio_unitario < 0)         AS precio_negativos,
       SUM(ABS(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4)) > 99999999.9999
        OR ABS(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4)) > 99999999.9999
        OR ABS(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4)) > 99999999.9999) AS fuera_de_rango
FROM pansys_test.materia_prima;

-- 1.7 Clasificación de cada valor según lo que le pasará al convertirlo (ver la explicación
--     de la cabecera). Por cada columna:
--       *_mostrado:  el valor tal como MySQL lo muestra hoy (y como lo recibe la API)
--       *_binario:   el valor binario almacenado, con la precisión de la conversión de MySQL
--       *_resultado: el valor previsto en DECIMAL(12,4)
--       *_categoria: 1 exacto | 2 ruido binario | 3 redondeo | 4 aproximación visible
--     Detalle por fila:
SELECT id, nombre,
       CAST(cantidad_disponible AS CHAR)                          AS disp_mostrado,
       CAST(cantidad_disponible AS DECIMAL(65,20))                AS disp_binario,
       ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4)      AS disp_resultado,
       CASE
         WHEN cantidad_disponible IS NULL THEN 'NULL'
         WHEN CAST(cantidad_disponible AS DECIMAL(65,20)) = ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) THEN '1 exacto'
         WHEN ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) = CAST(CAST(cantidad_disponible AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
         WHEN ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(cantidad_disponible AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
         ELSE '4 aproximación visible'
       END                                                        AS disp_categoria,
       CAST(stock_minimo AS CHAR)                                 AS min_mostrado,
       CAST(stock_minimo AS DECIMAL(65,20))                       AS min_binario,
       ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4)             AS min_resultado,
       CASE
         WHEN stock_minimo IS NULL THEN 'NULL'
         WHEN CAST(stock_minimo AS DECIMAL(65,20)) = ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) THEN '1 exacto'
         WHEN ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) = CAST(CAST(stock_minimo AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
         WHEN ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(stock_minimo AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
         ELSE '4 aproximación visible'
       END                                                        AS min_categoria,
       CAST(precio_unitario AS CHAR)                              AS precio_mostrado,
       CAST(precio_unitario AS DECIMAL(65,20))                    AS precio_binario,
       ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4)          AS precio_resultado,
       CASE
         WHEN precio_unitario IS NULL THEN 'NULL'
         WHEN CAST(precio_unitario AS DECIMAL(65,20)) = ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) THEN '1 exacto'
         WHEN ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) = CAST(CAST(precio_unitario AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
         WHEN ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(precio_unitario AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
         ELSE '4 aproximación visible'
       END                                                        AS precio_categoria
FROM pansys_test.materia_prima
ORDER BY id;

--     Resumen por columna y categoría.
--     Esperado: solo "1 exacto" o "2 ruido binario". Con "3 redondeo", "4 aproximación
--     visible" o "NULL", DETÉNGASE: esos valores cambiarían o el ALTER fallaría.
SELECT columna, categoria, COUNT(*) AS valores
FROM (
  SELECT 'cantidad_disponible' AS columna,
         CASE
           WHEN cantidad_disponible IS NULL THEN 'NULL'
           WHEN CAST(cantidad_disponible AS DECIMAL(65,20)) = ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) THEN '1 exacto'
           WHEN ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) = CAST(CAST(cantidad_disponible AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
           WHEN ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(cantidad_disponible AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
           ELSE '4 aproximación visible'
         END AS categoria
  FROM pansys_test.materia_prima
  UNION ALL
  SELECT 'stock_minimo',
         CASE
           WHEN stock_minimo IS NULL THEN 'NULL'
           WHEN CAST(stock_minimo AS DECIMAL(65,20)) = ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) THEN '1 exacto'
           WHEN ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) = CAST(CAST(stock_minimo AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
           WHEN ROUND(CAST(stock_minimo AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(stock_minimo AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
           ELSE '4 aproximación visible'
         END
  FROM pansys_test.materia_prima
  UNION ALL
  SELECT 'precio_unitario',
         CASE
           WHEN precio_unitario IS NULL THEN 'NULL'
           WHEN CAST(precio_unitario AS DECIMAL(65,20)) = ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) THEN '1 exacto'
           WHEN ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) = CAST(CAST(precio_unitario AS CHAR) AS DECIMAL(65,20)) THEN '2 ruido binario'
           WHEN ROUND(CAST(precio_unitario AS DECIMAL(65,20)), 4) = ROUND(CAST(CAST(precio_unitario AS CHAR) AS DECIMAL(65,20)), 4) THEN '3 redondeo'
           ELSE '4 aproximación visible'
         END
  FROM pansys_test.materia_prima
) clasificacion
GROUP BY columna, categoria
ORDER BY columna, categoria;

-- 1.8 Copia TEMPORAL de los datos, fila por fila, para compararlos después del ALTER.
--     CREATE ... LIKE copia la definición EXACTA de materia_prima (mismos tipos y tamaños,
--     FLOAT incluido, misma intercalación, DATETIME sin fracciones, mismos valores por defecto),
--     así que los valores originales se guardan sin ninguna conversión ni pérdida. Después se
--     añaden a la copia, y solo a ella, el valor mostrado y el valor previsto en DECIMAL(12,4).
--     No se copian las claves foráneas (no hacen falta en una copia temporal).
DROP TEMPORARY TABLE IF EXISTS pansys_test.copia_003_materia_prima;

CREATE TEMPORARY TABLE pansys_test.copia_003_materia_prima LIKE pansys_test.materia_prima;

ALTER TABLE pansys_test.copia_003_materia_prima
  ADD COLUMN disp_mostrado    VARCHAR(64)   NULL,
  ADD COLUMN min_mostrado     VARCHAR(64)   NULL,
  ADD COLUMN precio_mostrado  VARCHAR(64)   NULL,
  ADD COLUMN disp_previsto    DECIMAL(12,4) NULL,
  ADD COLUMN min_previsto     DECIMAL(12,4) NULL,
  ADD COLUMN precio_previsto  DECIMAL(12,4) NULL;

INSERT INTO pansys_test.copia_003_materia_prima
  (id, nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario,
   panaderia_id, estado, createdAt, updatedAt,
   disp_mostrado, min_mostrado, precio_mostrado,
   disp_previsto, min_previsto, precio_previsto)
SELECT id, nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario,
       panaderia_id, estado, createdAt, updatedAt,
       CAST(cantidad_disponible AS CHAR),
       CAST(stock_minimo        AS CHAR),
       CAST(precio_unitario     AS CHAR),
       ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4),
       ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4),
       ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4)
FROM pansys_test.materia_prima;

--     Comprobación de la copia. MySQL no permite usar una tabla TEMPORAL más de una vez en
--     la misma consulta (error 1137), por eso se hace en dos consultas.
--     Esperado: filas_en_copia = filas de 1.6
SELECT COUNT(*) AS filas_en_copia FROM pansys_test.copia_003_materia_prima;

--     Esperado: diferencias_con_el_original = 0 (compara FLOAT con FLOAT y textos byte a byte)
SELECT COUNT(*) AS diferencias_con_el_original
FROM pansys_test.materia_prima m
LEFT JOIN pansys_test.copia_003_materia_prima c ON c.id = m.id
WHERE c.id IS NULL
   OR NOT (CAST(m.nombre AS BINARY)        <=> CAST(c.nombre AS BINARY)
       AND CAST(m.unidad_medida AS BINARY) <=> CAST(c.unidad_medida AS BINARY)
       AND m.cantidad_disponible <=> c.cantidad_disponible
       AND m.stock_minimo        <=> c.stock_minimo
       AND m.precio_unitario     <=> c.precio_unitario
       AND m.panaderia_id <=> c.panaderia_id AND m.estado <=> c.estado
       AND m.createdAt    <=> c.createdAt    AND m.updatedAt <=> c.updatedAt);

-- 1.9 Huella de control adicional (complementa, no sustituye, la comparación por filas).
--     ANOTE filas y huella; el paso 3.6 debe dar lo mismo. Usa el valor PREVISTO a 4 decimales.
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, nombre, unidad_medida,
         COALESCE(CAST(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         panaderia_id, COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_test.materia_prima;

-- =====================================================================================
-- 2. MIGRACIÓN
-- =====================================================================================

-- 2.0 Valores NULL: si 1.6 mostró algún *_null > 0, DETÉNGASE y consulte antes de seguir.
--     Opción prevista (comentada a propósito porque ESCRIBE datos): sustituir NULL por 0,
--     el mismo valor por defecto de la columna. Si se aprueba y se usa, repita los pasos
--     1.6 a 1.9 antes del ALTER para que la copia refleje los valores corregidos.
-- UPDATE pansys_test.materia_prima SET cantidad_disponible = 0 WHERE cantidad_disponible IS NULL;
-- UPDATE pansys_test.materia_prima SET stock_minimo        = 0 WHERE stock_minimo        IS NULL;
-- UPDATE pansys_test.materia_prima SET precio_unitario     = 0 WHERE precio_unitario     IS NULL;

-- 2.1 Cambio de tipo, nulabilidad y valor por defecto de las tres columnas. Solo estas tres.
--     MODIFY conserva la posición de cada columna. Pasar de FLOAT a DECIMAL obliga a copiar la
--     tabla, así que ALGORITHM = COPY es el algoritmo compatible (INSTANT e INPLACE no admiten
--     este cambio de tipo). Con pocas filas es inmediato.
ALTER TABLE pansys_test.materia_prima
  MODIFY COLUMN cantidad_disponible DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  MODIFY COLUMN stock_minimo        DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  MODIFY COLUMN precio_unitario     DECIMAL(12,4) NOT NULL DEFAULT '0.0000',
  ALGORITHM = COPY;

-- =====================================================================================
-- 3. VERIFICACIÓN POSTERIOR (solo lectura)
-- =====================================================================================

-- 3.1 Definición nueva. Esperado: decimal(12,4) | NO | 0.0000 en las tres columnas
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
  AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
ORDER BY ORDINAL_POSITION;

-- 3.2 Diferencias de COLUMNAS con pansys_db, en ambos sentidos (misma consulta que 1.4).
--     Esperado: ninguna fila
SELECT objeto, nombre, diferencia
FROM (
  SELECT 'columna' AS objeto, CONVERT(t.COLUMN_NAME USING utf8mb4) AS nombre,
         CASE WHEN d.COLUMN_NAME IS NULL THEN 'sobra en pansys_test (no existe en pansys_db)'
         ELSE CONCAT_WS(', ',
           IF(t.ORDINAL_POSITION      <=> d.ORDINAL_POSITION,      NULL, 'posición'),
           IF(t.COLUMN_TYPE           <=> d.COLUMN_TYPE,           NULL, 'tipo'),
           IF(t.IS_NULLABLE           <=> d.IS_NULLABLE,           NULL, 'nulabilidad'),
           IF(t.COLUMN_DEFAULT        <=> d.COLUMN_DEFAULT,        NULL, 'valor por defecto'),
           IF(t.EXTRA                 <=> d.EXTRA,                 NULL, 'extra'),
           IF(t.CHARACTER_SET_NAME    <=> d.CHARACTER_SET_NAME,    NULL, 'juego de caracteres'),
           IF(t.COLLATION_NAME        <=> d.COLLATION_NAME,        NULL, 'intercalación'),
           IF(t.COLUMN_COMMENT        <=> d.COLUMN_COMMENT,        NULL, 'comentario'),
           IF(t.GENERATION_EXPRESSION <=> d.GENERATION_EXPRESSION, NULL, 'expresión generada'))
         END AS diferencia
  FROM information_schema.COLUMNS t
  LEFT JOIN information_schema.COLUMNS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.COLUMN_NAME = t.COLUMN_NAME
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'columna', CONVERT(d.COLUMN_NAME USING utf8mb4), 'falta en pansys_test (existe en pansys_db)'
  FROM information_schema.COLUMNS d
  LEFT JOIN information_schema.COLUMNS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima' AND t.COLUMN_NAME = d.COLUMN_NAME
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.COLUMN_NAME IS NULL
) comparacion
WHERE diferencia <> ''
ORDER BY nombre;

-- 3.3 Diferencias de ÍNDICES, RESTRICCIONES y OPCIONES DE TABLA (misma consulta que 1.5).
--     Esperado: ninguna fila
SELECT objeto, nombre, diferencia
FROM (
  SELECT 'índice' AS objeto, CONVERT(CONCAT(t.INDEX_NAME, ' #', t.SEQ_IN_INDEX) USING utf8mb4) AS nombre,
         CASE WHEN d.INDEX_NAME IS NULL THEN 'sobra en pansys_test'
         ELSE CONCAT_WS(', ',
           IF(t.COLUMN_NAME <=> d.COLUMN_NAME, NULL, 'columna'),
           IF(t.NON_UNIQUE  <=> d.NON_UNIQUE,  NULL, 'unicidad'),
           IF(t.SUB_PART    <=> d.SUB_PART,    NULL, 'longitud de prefijo'),
           IF(t.INDEX_TYPE  <=> d.INDEX_TYPE,  NULL, 'tipo de índice'),
           IF(t.COLLATION   <=> d.COLLATION,   NULL, 'orden'),
           IF(t.IS_VISIBLE  <=> d.IS_VISIBLE,  NULL, 'visibilidad'),
           IF(t.EXPRESSION  <=> d.EXPRESSION,  NULL, 'expresión'))
         END AS diferencia
  FROM information_schema.STATISTICS t
  LEFT JOIN information_schema.STATISTICS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
   AND d.INDEX_NAME = t.INDEX_NAME AND d.SEQ_IN_INDEX = t.SEQ_IN_INDEX
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'índice', CONVERT(CONCAT(d.INDEX_NAME, ' #', d.SEQ_IN_INDEX) USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.STATISTICS d
  LEFT JOIN information_schema.STATISTICS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
   AND t.INDEX_NAME = d.INDEX_NAME AND t.SEQ_IN_INDEX = d.SEQ_IN_INDEX
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.INDEX_NAME IS NULL

  UNION ALL
  SELECT 'restricción', CONVERT(t.CONSTRAINT_NAME USING utf8mb4),
         CASE WHEN d.CONSTRAINT_NAME IS NULL THEN 'sobra en pansys_test'
              WHEN NOT (t.CONSTRAINT_TYPE <=> d.CONSTRAINT_TYPE) THEN 'tipo'
              ELSE '' END
  FROM information_schema.TABLE_CONSTRAINTS t
  LEFT JOIN information_schema.TABLE_CONSTRAINTS d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'restricción', CONVERT(d.CONSTRAINT_NAME USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.TABLE_CONSTRAINTS d
  LEFT JOIN information_schema.TABLE_CONSTRAINTS t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME = d.CONSTRAINT_NAME
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME IS NULL

  UNION ALL
  SELECT 'columna de restricción', CONVERT(CONCAT(t.CONSTRAINT_NAME, ' #', t.ORDINAL_POSITION) USING utf8mb4),
         CASE WHEN d.CONSTRAINT_NAME IS NULL THEN 'sobra en pansys_test'
         ELSE CONCAT_WS(', ',
           IF(t.COLUMN_NAME            <=> d.COLUMN_NAME,            NULL, 'columna'),
           IF(t.REFERENCED_TABLE_NAME  <=> d.REFERENCED_TABLE_NAME,  NULL, 'tabla referenciada'),
           IF(t.REFERENCED_COLUMN_NAME <=> d.REFERENCED_COLUMN_NAME, NULL, 'columna referenciada'))
         END
  FROM information_schema.KEY_COLUMN_USAGE t
  LEFT JOIN information_schema.KEY_COLUMN_USAGE d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
   AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND d.ORDINAL_POSITION = t.ORDINAL_POSITION
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
  UNION ALL
  SELECT 'columna de restricción', CONVERT(CONCAT(d.CONSTRAINT_NAME, ' #', d.ORDINAL_POSITION) USING utf8mb4), 'falta en pansys_test'
  FROM information_schema.KEY_COLUMN_USAGE d
  LEFT JOIN information_schema.KEY_COLUMN_USAGE t
    ON t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
   AND t.CONSTRAINT_NAME = d.CONSTRAINT_NAME AND t.ORDINAL_POSITION = d.ORDINAL_POSITION
  WHERE d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND t.CONSTRAINT_NAME IS NULL

  UNION ALL
  SELECT 'clave foránea', CONVERT(t.CONSTRAINT_NAME USING utf8mb4),
         CONCAT_WS(', ',
           IF(t.REFERENCED_TABLE_NAME <=> d.REFERENCED_TABLE_NAME, NULL, 'tabla referenciada'),
           IF(t.UPDATE_RULE           <=> d.UPDATE_RULE,           NULL, 'ON UPDATE'),
           IF(t.DELETE_RULE           <=> d.DELETE_RULE,           NULL, 'ON DELETE'),
           IF(t.MATCH_OPTION          <=> d.MATCH_OPTION,          NULL, 'MATCH'))
  FROM information_schema.REFERENTIAL_CONSTRAINTS t
  JOIN information_schema.REFERENTIAL_CONSTRAINTS d
    ON d.CONSTRAINT_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima' AND d.CONSTRAINT_NAME = t.CONSTRAINT_NAME
  WHERE t.CONSTRAINT_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'

  UNION ALL
  SELECT 'condición CHECK', CONVERT(tc.CONSTRAINT_NAME USING utf8mb4),
         IF(ct.CHECK_CLAUSE <=> cd.CHECK_CLAUSE, '', 'condición distinta')
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS ct
    ON ct.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND ct.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  JOIN information_schema.CHECK_CONSTRAINTS cd
    ON cd.CONSTRAINT_SCHEMA = 'pansys_db' AND cd.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = 'pansys_test' AND tc.TABLE_NAME = 'materia_prima' AND tc.CONSTRAINT_TYPE = 'CHECK'

  UNION ALL
  SELECT 'tabla', CONVERT('materia_prima' USING utf8mb4),
         CONCAT_WS(', ',
           IF(t.ENGINE          <=> d.ENGINE,          NULL, 'motor'),
           IF(t.TABLE_COLLATION <=> d.TABLE_COLLATION, NULL, 'intercalación'),
           IF(t.ROW_FORMAT      <=> d.ROW_FORMAT,      NULL, 'formato de fila'),
           IF(t.CREATE_OPTIONS  <=> d.CREATE_OPTIONS,  NULL, 'opciones de creación'),
           IF(t.TABLE_COMMENT   <=> d.TABLE_COMMENT,   NULL, 'comentario'))
  FROM information_schema.TABLES t
  JOIN information_schema.TABLES d
    ON d.TABLE_SCHEMA = 'pansys_db' AND d.TABLE_NAME = 'materia_prima'
  WHERE t.TABLE_SCHEMA = 'pansys_test' AND t.TABLE_NAME = 'materia_prima'
) comparacion
WHERE diferencia <> ''
ORDER BY objeto, nombre;

-- 3.4 Comparación FILA POR FILA con la copia del paso 1.8. Por cada columna:
--       *_antes_mostrado / *_antes_binario: el valor FLOAT original (copiado sin conversión)
--       *_previsto: el resultado previsto en 1.8; *_despues: el valor real tras el ALTER
--       *_prevision_ok:      el resultado real es el previsto            (esperado: 1)
--       *_igual_a_mostrado:  el resultado real es el valor que se veía   (1 en categorías 1 y 2)
--       *_igual_a_binario:   el resultado real es el número binario exacto que había
--                            (1 solo en la categoría 1; 0 indica que cambió la aproximación
--                            binaria o el valor, según la categoría de 1.7)
--       resto_igual: nombre y unidad (byte a byte), panadería, estado y fechas sin cambios
--     Las comparaciones numéricas se hacen entre DECIMAL, nunca convirtiendo a FLOAT.
SELECT c.id, c.nombre,
       c.disp_mostrado                                  AS disp_antes_mostrado,
       CAST(c.cantidad_disponible AS DECIMAL(65,20))    AS disp_antes_binario,
       c.disp_previsto,
       m.cantidad_disponible                            AS disp_despues,
       (m.cantidad_disponible <=> c.disp_previsto)                                 AS disp_prevision_ok,
       (m.cantidad_disponible <=> CAST(c.disp_mostrado AS DECIMAL(65,20)))         AS disp_igual_a_mostrado,
       (m.cantidad_disponible <=> CAST(c.cantidad_disponible AS DECIMAL(65,20)))   AS disp_igual_a_binario,
       c.min_mostrado                                   AS min_antes_mostrado,
       CAST(c.stock_minimo AS DECIMAL(65,20))           AS min_antes_binario,
       c.min_previsto,
       m.stock_minimo                                   AS min_despues,
       (m.stock_minimo <=> c.min_previsto)                                         AS min_prevision_ok,
       (m.stock_minimo <=> CAST(c.min_mostrado AS DECIMAL(65,20)))                 AS min_igual_a_mostrado,
       (m.stock_minimo <=> CAST(c.stock_minimo AS DECIMAL(65,20)))                 AS min_igual_a_binario,
       c.precio_mostrado                                AS precio_antes_mostrado,
       CAST(c.precio_unitario AS DECIMAL(65,20))        AS precio_antes_binario,
       c.precio_previsto,
       m.precio_unitario                                AS precio_despues,
       (m.precio_unitario <=> c.precio_previsto)                                   AS precio_prevision_ok,
       (m.precio_unitario <=> CAST(c.precio_mostrado AS DECIMAL(65,20)))           AS precio_igual_a_mostrado,
       (m.precio_unitario <=> CAST(c.precio_unitario AS DECIMAL(65,20)))           AS precio_igual_a_binario,
       (CAST(m.nombre AS BINARY)        <=> CAST(c.nombre AS BINARY)
        AND CAST(m.unidad_medida AS BINARY) <=> CAST(c.unidad_medida AS BINARY)
        AND m.panaderia_id <=> c.panaderia_id AND m.estado <=> c.estado
        AND m.createdAt    <=> c.createdAt    AND m.updatedAt <=> c.updatedAt)     AS resto_igual
FROM pansys_test.copia_003_materia_prima c
LEFT JOIN pansys_test.materia_prima m ON m.id = c.id
ORDER BY c.id;

-- 3.5 Resumen de la comparación por filas.
--     Esperado: filas_antes = filas_despues; filas_que_faltan = filas_nuevas = 0;
--     filas_con_prevision_fallida = 0; filas_con_otros_campos_cambiados = 0.
--     filas_distintas_del_valor_mostrado: filas con algún valor de categoría 3 o 4 (0 si 1.7
--     solo mostró categorías 1 y 2). filas_distintas_del_binario: filas con algún valor de
--     categoría 2, 3 o 4 (informativo: indica que el número almacenado cambió).
--     Se divide en varias consultas porque MySQL no permite usar una tabla TEMPORAL más de
--     una vez en la misma consulta (error 1137).
SELECT COUNT(*) AS filas_antes FROM pansys_test.copia_003_materia_prima;

SELECT COUNT(*) AS filas_despues FROM pansys_test.materia_prima;

SELECT COUNT(*) AS filas_que_faltan
FROM pansys_test.copia_003_materia_prima c
LEFT JOIN pansys_test.materia_prima m ON m.id = c.id
WHERE m.id IS NULL;

SELECT COUNT(*) AS filas_nuevas
FROM pansys_test.materia_prima m
LEFT JOIN pansys_test.copia_003_materia_prima c ON c.id = m.id
WHERE c.id IS NULL;

SELECT
  COALESCE(SUM(NOT (m.cantidad_disponible <=> c.disp_previsto
                AND m.stock_minimo        <=> c.min_previsto
                AND m.precio_unitario     <=> c.precio_previsto)), 0) AS filas_con_prevision_fallida,
  COALESCE(SUM(NOT (CAST(m.nombre AS BINARY)        <=> CAST(c.nombre AS BINARY)
                AND CAST(m.unidad_medida AS BINARY) <=> CAST(c.unidad_medida AS BINARY)
                AND m.panaderia_id <=> c.panaderia_id AND m.estado <=> c.estado
                AND m.createdAt    <=> c.createdAt    AND m.updatedAt <=> c.updatedAt)), 0) AS filas_con_otros_campos_cambiados,
  COALESCE(SUM(NOT (m.cantidad_disponible <=> CAST(c.disp_mostrado   AS DECIMAL(65,20))
                AND m.stock_minimo        <=> CAST(c.min_mostrado    AS DECIMAL(65,20))
                AND m.precio_unitario     <=> CAST(c.precio_mostrado AS DECIMAL(65,20)))), 0) AS filas_distintas_del_valor_mostrado,
  COALESCE(SUM(NOT (m.cantidad_disponible <=> CAST(c.cantidad_disponible AS DECIMAL(65,20))
                AND m.stock_minimo        <=> CAST(c.stock_minimo        AS DECIMAL(65,20))
                AND m.precio_unitario     <=> CAST(c.precio_unitario     AS DECIMAL(65,20)))), 0) AS filas_distintas_del_binario
FROM pansys_test.copia_003_materia_prima c
JOIN pansys_test.materia_prima m ON m.id = c.id;

-- 3.6 Huella de control adicional. Esperado: filas y huella IDÉNTICAS a las anotadas en 1.9
SELECT COUNT(*) AS filas,
       BIT_XOR(CRC32(CONCAT_WS('|', id, nombre, unidad_medida,
         COALESCE(CAST(ROUND(CAST(cantidad_disponible AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(stock_minimo        AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         COALESCE(CAST(ROUND(CAST(precio_unitario     AS DECIMAL(65,20)), 4) AS DECIMAL(12,4)), 'NULL'),
         panaderia_id, COALESCE(estado, 'NULL'), createdAt, updatedAt))) AS huella
FROM pansys_test.materia_prima;

-- 3.7 Definición completa: debe coincidir con la de pansys_db salvo el valor de AUTO_INCREMENT
SHOW CREATE TABLE pansys_test.materia_prima;

-- =====================================================================================
-- 4. REVERSIÓN (solo si fuera necesario; TODO comentado a propósito)
-- =====================================================================================
-- Devuelve las tres columnas a su definición anterior exacta: FLOAT, admite NULL, DEFAULT 0.
--
-- ADVERTENCIAS:
--   * PUEDE PERDER PRECISIÓN: FLOAT guarda unos 7 dígitos significativos y solo valores
--     aproximados. Cualquier valor guardado en DECIMAL después de la migración puede no
--     volver intacto (por ejemplo, 25000.1 quedaría como 25000.099609375 y 1234567.8912
--     como 1234567.875). No hay garantía de recuperar los valores binarios originales.
--   * Deja pansys_test otra vez distinta de pansys_db: las pruebas dejarían de reflejar el
--     esquema de producción.
--   * Si la copia temporal del paso 1.8 sigue abierta en la misma conexión, contiene los
--     valores FLOAT originales exactos de las filas que existían antes del ALTER.
--   * Alternativa: recrear la base de pruebas con crear_pansys_test.sql (DROP DATABASE
--     pansys_test; y ejecutar el script), que también crea estas columnas como FLOAT.
--   * Es DDL: COMMIT implícito, sin ROLLBACK posible.
--
-- ALTER TABLE pansys_test.materia_prima
--   MODIFY COLUMN cantidad_disponible FLOAT NULL DEFAULT '0',
--   MODIFY COLUMN stock_minimo        FLOAT NULL DEFAULT '0',
--   MODIFY COLUMN precio_unitario     FLOAT NULL DEFAULT '0',
--   ALGORITHM = COPY;
--
-- Verificación tras revertir (esperado: float | YES | 0 en las tres columnas):
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
-- FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
--   AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')
-- ORDER BY ORDINAL_POSITION;

-- =====================================================================================
-- 5. LIMPIEZA (después de revisar la sección 3)
-- =====================================================================================
-- Elimina solo la copia temporal de esta conexión; no afecta a materia_prima.
DROP TEMPORARY TABLE IF EXISTS pansys_test.copia_003_materia_prima;
