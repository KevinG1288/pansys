# Instalación limpia de Pansys (base pública nueva)

Crea desde cero una base de Pansys con **exactamente dos panaderías y sus dos administradores**.
No copia nada de `pansys_db` ni de `pansys_test`: ni usuarios, ni contraseñas, ni productos, ni
ventas, ni datos de demostración. Las bases existentes no se tocan.

> Estado: **preparado y probado sin MySQL** (fases 1 y F2-0). Nada de esto se ha ejecutado contra
> ningún servidor. El ensayo aislado y la instalación pública necesitan autorización expresa, paso a paso.

## Archivos

| Archivo | Qué hace |
|---|---|
| `01_esquema.sql` | Las 17 tablas en su estado final (001–006) y los 3 roles fijos. Compuertas previas (identidad positiva, base vacía…) y verificación posterior |
| `02_instalar_panaderias.js` (+ `instalador.js`) | Dos panaderías y dos administradores en **una** transacción. Contraseñas de administradores ocultas, solo hash bcrypt (coste 12) |
| `03_crear_cuenta.js` (+ `cuentas.js`) | Cuenta MySQL de **instalación** (antes de 01) o de la **aplicación** (después de 02). Contraseña generada por MySQL, solo en un archivo restringido |
| `04_verificar.sql` | Verificación de solo lectura del resultado |
| `ejecutar_sql.js` (+ `ejecutor.js`) | Ejecuta 01 o 04 con SHA-256 aprobado, identidad verificada y UTF-8 exacto |
| `desmontar_ensayo.js` (+ `desmontaje.js`) | **Solo ensayo**: elimina las cuentas y bases del ensayo, con protecciones |
| `comun.js`, `cli.js` | Parámetros, identidad, lectura oculta, archivos de credenciales |
| `parametros.ejemplo.json` | Modelo de parámetros (sin secretos; con valores de ejemplo que todas las herramientas rechazan) |
| `../../pruebas/instalacion*.unitarias.js` | Pruebas sin MySQL (red bloqueada, dobles) |

Los scripts históricos (`001`–`004`, `pruebas/`, y los archivos locales sin seguimiento `005` y `a5`)
**no** se usan en una instalación nueva. Se conservan como histórico.

## Principios de seguridad

- **Identidad positiva**: los parámetros fijan el servidor esperado (`puerto`, `server_uuid` y el valor
  exacto de `@@datadir`). Cada herramienta lo comprueba al conectar, y 01/04 lo vuelven a comprobar
  dentro de MySQL como primera sentencia (`@pansys_uuid`, `@pansys_puerto`, `@pansys_datadir`).
  Ningún archivo versionado contiene identificadores de un servidor concreto.
- **Secretos**:
  - administradores de las panaderías: se teclean de forma oculta (dos veces); solo se guarda su hash;
  - administrador de MySQL (root): se teclea de forma oculta en 03 y en el desmontaje;
  - cuentas de instalación y de aplicación: las genera MySQL (`RANDOM PASSWORD`), se leen solo en
    memoria y se guardan en un `.env` **fuera del repositorio**, creado en exclusiva y restringido
    (Windows: herencia retirada y un único permiso para el usuario actual; Linux: 0600) **antes** de
    escribir el secreto. Las herramientas comprueban esa restricción antes de leerlo.
  - Nunca en argumentos, salida, registros, historial ni archivos temporales. Los errores de MySQL se
    muestran solo por su código.
- **Sin reversiones automáticas**: ante un fallo, cada herramienta se detiene e informa del estado.
  Si el estado es incierto (conexión perdida) termina con código 2 y no hace nada más.

## Requisitos

- MySQL 8.0.18 o superior de la serie 8.0 (CHECK desde 8.0.16; `RANDOM PASSWORD` desde 8.0.18),
  `sql_mode` con `STRICT_TRANS_TABLES`.
- Node y `backend/node_modules` (`mysql2`, `bcrypt`, `dotenv`, ya dependencias). Sin dependencias nuevas.
- Terminal interactiva (las contraseñas no se aceptan por tubería, archivo, argumento ni variable).
- Una carpeta **fuera del repositorio** para el JSON de parámetros y los archivos de credenciales.

## Parámetros

Copie `parametros.ejemplo.json` fuera del repositorio y complételo:

- `identidad`: `puerto`, `server_uuid` (minúsculas) y `datadir` **exactamente** como los devuelve
  `SELECT @@port, @@server_uuid, @@datadir` en el servidor de destino (en Windows termina en `\`).
- `conexion`: `host` y `base` (nombre nuevo; minúsculas, letras, números y `_`).
- `administrador_mysql`: la cuenta con la que se crean bases y cuentas (p. ej. `root`).
- `cuentas.instalador` / `cuentas.aplicacion`: `usuario`, `host` (`127.0.0.1`, `localhost` o `::1`) y
  `credenciales` (ruta absoluta `.env` fuera del repositorio; el archivo NO debe existir todavía).
- `sha256`: SHA-256 **aprobado** de `01_esquema.sql` y `04_verificar.sql` (del manifiesto).
- `panaderias`: las dos panaderías (nombre, dirección, localidad, teléfono opcional, `en_red`) y el
  correo **ASCII** de su administrador (MySQL compara correos sin distinguir mayúsculas ni acentos).
- `desmontaje` (solo ensayo): bases (`pansys_inst_*`), cuentas (`pansys_instalador`, `pansys_*_ensayo`)
  y **bases protegidas** que deben seguir intactas.

## Procedimiento

Desde `backend/`, con la aplicación **detenida** y `<P>` = ruta del JSON de parámetros.

0. **Base nueva** (administrador de MySQL; el servidor debe ser el de `identidad`):
   ```sql
   CREATE DATABASE <base> CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   ```
1. **Cuenta de instalación**: `node database/instalacion/03_crear_cuenta.js --parametros=<P> --tipo=instalador`
   (SELECT, INSERT, UPDATE, CREATE, ALTER, REFERENCES solo sobre `<base>`; sin DROP, DELETE ni globales).
2. **Esquema**: `node database/instalacion/ejecutar_sql.js --parametros=<P> --script=01_esquema.sql --cuenta=instalador`
   → `COMPLETADO` y la fila `ESQUEMA INSTALADO: 17 tablas, 41 claves foraneas, 32 CHECK, 3 roles`.
3. **Panaderías y administradores**: `node database/instalacion/02_instalar_panaderias.js --parametros=<P>`
4. **Cuenta de la aplicación**: `node database/instalacion/03_crear_cuenta.js --parametros=<P> --tipo=aplicacion`
   (SELECT, INSERT, UPDATE sobre `<base>`; DELETE solo en `receta_producto`). Su archivo `.env`
   contiene `DB_USER` y `DB_PASSWORD` para la configuración de producción.
5. **Verificación**: `node database/instalacion/ejecutar_sql.js --parametros=<P> --script=04_verificar.sql --cuenta=aplicacion`
   → `VERIFICACION SUPERADA`.
6. **Cierre** (administrador de MySQL): retirar la cuenta de instalación (`DROP USER` o `ACCOUNT LOCK`)
   y borrar su archivo de credenciales; primer respaldo (`mysqldump --single-transaction`) con su SHA-256.

### Alternativa con el cliente `mysql` (01 y 04)

Solo si no se usa `ejecutar_sql.js`. En Windows PowerShell 5.1 `<` no existe y la tubería `|`
recodifica el archivo (estropea los acentos de los COMMENT): use `cmd /c` y UTF-8 explícito:

```
cmd /c "mysql --no-defaults --protocol=TCP -h <host> -P <puerto> -u <cuenta> -p --default-character-set=utf8mb4 --batch "--init-command=SET @pansys_uuid='<uuid>', @pansys_puerto=<puerto>, @pansys_datadir='<datadir con \\>'" <base> < 01_esquema.sql"
```

Una compuerta falsa provoca **ERROR 3141**. En MySQL 8.0.44 el mensaje **no** incluye el texto
«ABORTAR» (solo `Invalid JSON text ... "Invalid value." at position 0`): identifique la compuerta por
el número de línea (`at line N`). `ejecutar_sql.js` muestra directamente el texto `ABORTAR: …` de la
sentencia que falló, su número y su línea.

## Fallos y recuperación

| Dónde falla | Estado | Qué hacer |
|---|---|---|
| Cualquier comprobación previa (identidad, parámetros, SHA-256, credenciales) | Nada modificado | Corregir la causa y repetir |
| 03: no se puede crear/restringir el archivo | Nada en MySQL | Corregir la carpeta o permisos y repetir |
| 03: `CREATE USER` rechazado | Sin cuenta; archivo vacío retirado | Repetir |
| 03: contraseña no guardable, o fallo al escribirla | Cuenta **existe** sin contraseña guardada; archivo retirado | Retirar la cuenta (desmontaje en ensayo; `DROP USER` con autorización en producción) y repetir |
| 03: fallo en `GRANT` o en la verificación | Cuenta **existe** (privilegios incompletos o no verificados); credenciales conservadas | No usarla. Revisar `SHOW GRANTS`; retirarla y repetir |
| 03: conexión perdida (código 2) | **Incierto** | No repetir a ciegas: comprobar si la cuenta existe |
| 01: compuerta previa | Nada creado («no se ha modificado nada») | Corregir y repetir |
| 01: tras algún CREATE/ALTER | Base incompleta («ya había modificado la base») | No repetir 01 sobre ella. Eliminar **esa base nueva** (ensayo: desmontaje; producción: `DROP DATABASE` con autorización, solo si no tiene datos), crearla vacía y repetir desde el paso 0 |
| 01/04: conexión perdida (código 2) | **Incierto** | Ejecutar 04 o inspeccionar antes de nada |
| 02 antes de la transacción | Nada modificado | Corregir y repetir |
| 02 dentro de la transacción | ROLLBACK: usuarios y panaderías vacías | Repetir 02 |
| 02: conexión perdida o fallo del COMMIT (código 2) | **Incierto** | Ejecutar 04: si pasa, está instalado; si usuarios/panaderias están vacías, repetir 02; cualquier otro estado, detenerse |
| Después de abrir el servicio | Datos reales | Solo restauración desde respaldo. Nunca DROP |

**Límites de las verificaciones.** 01 y 04 comprueban recuentos (tablas, claves foráneas, CHECK), el
ciclo, varias columnas clave, roles, enlaces y hashes. No comparan el texto completo de cada
definición, los valores por defecto ni los comentarios (acentos): eso se hace en el ensayo comparando
`information_schema` con una base de referencia. `instalacion.unitarias.js` compara estáticamente el
esquema con `crear_pansys_test.sql` + 005 + 006.

### Ciclo `usuarios` ↔ `panaderias`

`panaderias.usuario_id` es obligatoria (FK a usuarios, CASCADE) y `usuarios.panaderia_id` es opcional
(FK a panaderias, RESTRICT). En el esquema se crea `usuarios` sin su clave hacia `panaderias`, después
`panaderias`, y la clave se añade con `ALTER TABLE` (nunca se desactiva `foreign_key_checks`). En los
datos, dentro de una transacción: administradores con `panaderia_id NULL` → panaderías con su
`usuario_id` → `UPDATE` que asigna a cada administrador su panadería.

## Privilegios mínimos de la aplicación (inventario del código)

- `RecetaProducto.destroy` (`src/modules/produccion/recetas.service.js`) es el **único** borrado físico:
  DELETE solo en `receta_producto`. Las demás «eliminaciones» son bajas lógicas (`estado = 0`).
- `INSERT … ON DUPLICATE KEY UPDATE` (red_parejas) y `SELECT … FOR UPDATE` necesitan solo INSERT,
  UPDATE y SELECT.
- No hay `sync()`, `queryInterface`, migraciones automáticas, `REPLACE`, `TRUNCATE` ni `bulkDelete`.
- `pruebas/instalacion.unitarias.js` vuelve a comprobar este inventario.
- Con privilegios mínimos, MySQL informa de las violaciones de clave foránea con 1216/1217 en lugar de
  1452/1451. El módulo de red ya los trata; el resto se comprobará con las suites de integración.

### Nombres de base en GRANT y `partial_revokes`

`03_crear_cuenta.js` lee `@@GLOBAL.partial_revokes` antes de escribir nada (si no vale exactamente 0 o 1,
se detiene) y escribe el nombre de la base del GRANT según el modo:

| `partial_revokes` | Nombre en el GRANT | Cómo lo interpreta MySQL |
|---|---|---|
| OFF (0) | `` `pansys\_mi\_base` `` (cada `_` escapado) | `_` es comodín; `\_` es el carácter literal |
| ON (1) | `` `pansys_mi_base` `` (literal) | El nombre es siempre literal y `\` **no** es escape |

Comprobado en el ensayo aislado (E3-2, 2026-11-15, MySQL 8.0.44 con `partial_revokes=ON`): el nombre
escapado `` `pansys\_inst\_ensayo` `` quedó guardado en `mysql.db` con barras invertidas reales y la cuenta no
podía usar `pansys_inst_ensayo` (`ER_DBACCESS_DENIED_ERROR`). La verificación acepta **solo** la forma que
corresponde al modo detectado y exige una sola base; la prueba funcional (conectar con la cuenta y la base
real) sigue siendo la comprobación final. Los GRANT de tabla usan siempre el nombre literal.

## Diferencias conocidas respecto a `pansys_test`

1. `usuarios`: un solo índice único `email` (en `pansys_test` hay además `email_2` … `email_59`).
2. `usuarios_ibfk_4` se crea con `ALTER TABLE` (mismo nombre, columnas y reglas).
3. `version_fila`, `uq_materia_prima_id_panaderia`, `chk_materia_prima_version_fila`, `localidad` y
   `chk_panaderias_localidad` van en el `CREATE TABLE` con la misma definición, posición y marca `SQL006`.
4. Sin las compuertas propias de `pansys_test` (PROCESS, otras conexiones, huellas); con identidad
   positiva y base vacía. Se conservan todas las restricciones de integridad.
5. Datos: solo los 3 roles.
6. Solo comparables con servidor: texto que MySQL guarda de los CHECK, orden interno de índices y
   AUTO_INCREMENT.

## Nombre de la base pública (pendiente)

Los scripts no fijan ningún nombre. El backend solo protege hoy el nombre `pansys_db`
(`src/config/arranque.js`). Si se elige otro, la propuesta (no implementada) es: en producción, exigir
`DB_NAME` igual a `PANSYS_AUTORIZAR_BASE_PRODUCCION` (válido y distinto de `pansys_test`) y comprobar
`SELECT DATABASE()` tras conectar; fuera de producción, seguir rechazando `pansys_db`.
