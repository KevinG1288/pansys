# SQL 006 (red colaborativa) en `pansys_test`: preparación, respaldo, instalación y reversión

Solo para la base de **pruebas** `pansys_test`. **Nunca** para `pansys_db`: todos los scripts nombran
`pansys_test` en cada sentencia y abortan si `DATABASE()` no es `pansys_test`.

Estado: **E0a terminada** (archivos preparados y revisados sin conexión). **Nada aplicado.** Cada fase
de abajo necesita una autorización expresa e independiente.

## Archivos

| Archivo | Qué hace |
|---|---|
| `006_red_colaborativa_pansys_test.sql` | Instala el SQL 006: `version_fila`, `uq_materia_prima_id_panaderia` y `chk_materia_prima_version_fila` en `materia_prima`; `localidad` y `chk_panaderias_localidad` en `panaderias`; las 5 tablas de la red. Compuertas previas, huellas antes y después, y verificación posterior |
| `006_reversion_pansys_test.sql` | Revierte **solo** los objetos del 006 (marca `SQL006`). Aborta si hay datos en la red, localidades rellenadas o `version_fila > 0` |
| `006_datos_demo_red_pansys_test.sql` | Datos de la demostración entre las panaderías 1 y 2 (una transacción) |

Los dos primeros son **idénticos byte a byte** a la versión validada (fuente aprobada, revisión 3, sin
su primera línea de guarda): es el mismo texto que se ejecutó en un ensayo aislado (base de pruebas independiente)
(L1a 20261105T010135Z y L1b 20261105T010609Z, E6 44/44), con el nombre de la base cambiado.

| Archivo | SHA-256 | Bytes |
|---|---|---|
| `006_red_colaborativa_pansys_test.sql` | `0679206cd4820a478ab8cfc0b5a456090757989307170b40290ff09789da82f0` | 25 207 |
| `006_reversion_pansys_test.sql` | `fd343ba7172d7fe441c42a04d550711a452940ece331393af829155a02cfd5b6` | 22 491 |

Antes de ejecutar cualquiera, compruebe su SHA-256 (`certutil -hashfile <archivo> SHA256`).
La cabecera interna de los dos dice «BORRADOR v3 ... NO EJECUTAR»: es el texto de la fuente aprobada,
que no se ha modificado para conservar la identidad con lo validado.

## Fases

### E0a. Preparación (hecha)
Archivos creados y revisados sin conexión. No hubo ninguna operación sobre bases de datos.

### Requisitos previos de E0b (antes de tocar `pansys_test`)
1. **Prueba D2 en el ensayo** (`IGNORE_SPACE`): `pansys_test` está en el mismo servidor que
   `pansys_db`, cuyo `sql_mode` global incluye `IGNORE_SPACE`; el ensayo validó el 006 sin él. D2
   (`sql/e7_d2_ignore_space.sql`, lote L2 del ensayo) no se ha ejecutado nunca. Ejecútela antes, con
   su propia autorización, y compruebe también `SELECT @@GLOBAL.sql_mode` del servidor real.
2. **Cuenta de MySQL para `pansys_test`** (no la de `.env.produccion`), con `PROCESS` directo y, sobre
   `pansys_test`, `SELECT, INSERT, UPDATE, CREATE, ALTER, DROP, REFERENCES` (DROP solo para la
   reversión). Las compuertas exigen `PROCESS` y que no haya otras conexiones.
3. **Ninguna otra conexión al servidor**: aplicación detenida (`npm run dev`, demo), **MySQL Workbench
   cerrado durante toda E0b** (abre varias sesiones y las compuertas «sin otras conexiones» abortarían),
   sin suites de `backend/pruebas/`. La compuerta cuenta TODAS las conexiones del servidor, también las
   de `pansys_db`.
4. `pansys_test` con 001 a 005 aplicados (el 005 se aplicó el 2026-10-28) y sin eventos habilitados.
5. **GTID desactivado (obligatorio)**: `@@GLOBAL.gtid_mode` debe ser exactamente `'OFF'`. Con GTID activo,
   `mysqldump --single-transaction` exige `RELOAD` o `FLUSH_TABLES`. Si el valor es distinto de `OFF`,
   **E0b se detiene**: no se conceden `RELOAD` ni `FLUSH_TABLES` y se presenta una propuesta nueva.
6. **Conexión de la cuenta administrativa**: siempre por TCP hacia `127.0.0.1`
   (`--protocol=TCP --host=127.0.0.1`), nunca `localhost`: la cuenta se crea con el host `127.0.0.1`.
7. **SSL**: si el servidor no tiene SSL (`have_ssl` distinto de `YES`), el primer inicio de sesión con
   `caching_sha2_password` por TCP falla con `ERROR 2061`. En ese caso añada `--get-server-public-key` a
   todas las órdenes `mysql` y `mysqldump` de esta guía.

### E0b-1. Respaldo de `pansys_test` (obligatorio)
Desde `cmd.exe` (la contraseña se teclea en el aviso; nunca en la orden):

```bat
mysqldump --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=pansys_test_admin --password ^
  --single-transaction --set-gtid-purged=OFF --routines --triggers --no-tablespaces --default-character-set=utf8mb4 ^
  --result-file=<CARPETA_RESPALDOS>\pansys_test_pre_006_<UTC>.sql --log-error=<CARPETA_RESPALDOS>\pansys_test_pre_006_<UTC>.err pansys_test
certutil -hashfile <CARPETA_RESPALDOS>\pansys_test_pre_006_<UTC>.sql SHA256
```

Se acepta con código 0, `.err` vacío y la última línea `-- Dump completed on ...`. Guarde el SHA-256.
Recomendado: restaurarlo en una base desechable para comprobar que es válido antes de seguir.

### E0b-2. Instalación del 006
El archivo **completo**, en **una** invocación por lotes, sin `--force`, desde `cmd.exe`:

```bat
mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=pansys_test_admin --password ^
  --database=pansys_test --skip-reconnect --table --show-warnings --default-character-set=utf8mb4 ^
  "--init-command=DO JSON_TYPE(IF(DATABASE() = 'pansys_test', '[]', 'ABORTAR: no es pansys_test'))" ^
  < backend\database\pruebas\006_red_colaborativa_pansys_test.sql ^
  1> <CARPETA_RESPALDOS>\e0b_006_<UTC>.out 2> <CARPETA_RESPALDOS>\e0b_006_<UTC>.err
echo %ERRORLEVEL%
```

Se acepta con: código 0, `.err` vacío y, en `.out`, la fila `ANTES` y la fila `DESPUES` con las
**mismas** huellas (`materia_prima`, `panaderias`, esquema previo y recuentos) y los 7 `SHOW CREATE
TABLE` finales. Un error 3141 («Invalid JSON text ... json_type») es una compuerta: **ABORTADO**; no
repita nada y conserve `.out` y `.err`. Cada `ALTER`/`CREATE` es DDL atómico: si falla a mitad, la
salida es la reversión (abajo), nunca repetir la instalación.

### E0b-3. Datos de la demostración
Solo después de E0b-2 aceptada. Misma forma de invocación, con
`006_datos_demo_red_pansys_test.sql` y salida `e0b_demo_<UTC>.out` / `.err`. Se acepta con código 0,
`.err` vacío y la fila `DATOS_DEMO_APLICADOS` seguida del resumen:

- panadería 1 «Kennedy Central» y panadería 2 «Patio Bonito», las dos con `en_red = 1`;
- cuentas: `admin@pansys.test` y `panadero1@pansys.test` (panadería 1), `admin2@pansys.test` (nueva)
  y `panadero2@pansys.test` (panadería 2);
- 10 materias con `version_fila = 0`: Harina de trigo, Azúcar, Mantequilla (kg) y Levadura fresca (g)
  en las dos panaderías; Huevos (unidad) en la 1 y Leche entera (l) en la 2.

Las escrituras van en una transacción y se verifican antes del `COMMIT`: si algo falla, no queda nada.

### E0b-4. Contraseñas de la demostración
Ninguna cuenta de la semilla ni `admin2@pansys.test` tiene contraseña utilizable (`'!'`). Con la
aplicación en modo desarrollo y Mailpit, use «¿Olvidaste tu contraseña?» con cada correo y fije la
contraseña desde el enlace recibido. Las contraseñas no se escriben en ningún archivo.

## Vuelta atrás

| Situación | Qué hacer |
|---|---|
| E0b-2 falló a mitad o se aplicó y se quiere quitar, **sin** datos de demostración ni uso de la red | Reversión: `006_reversion_pansys_test.sql` con la misma forma de invocación. Se acepta con código 0, `.err` vacío y la fila `REVERTIDO` con las mismas huellas que `ANTES` |
| E0b-3 aplicada, o la red ya se usó (solicitudes, movimientos, `version_fila > 0`) | La reversión **aborta a propósito** (no borra datos). Recuperación: restaurar el respaldo de E0b-1 |
| E0b-3 falló | Nada que deshacer: la transacción no se confirmó |

**Restaurar el respaldo** (con autorización, cuenta administrativa del servidor de pruebas): como las
tablas de la red tienen claves foráneas hacia `materia_prima`, `panaderias` y `usuarios`, el volcado
no se puede cargar encima. Se recrea la base y se carga entero:

```bat
mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=<cuenta_admin> --password ^
  "--execute=DROP DATABASE pansys_test; CREATE DATABASE pansys_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=<cuenta_admin> --password ^
  --database=pansys_test --skip-reconnect --default-character-set=utf8mb4 ^
  < <CARPETA_RESPALDOS>\pansys_test_pre_006_<UTC>.sql
```

Compruebe antes el SHA-256 del respaldo y **revise dos veces que el nombre es `pansys_test`**.
Tras restaurar, verifique los recuentos frente a los del respaldo.
