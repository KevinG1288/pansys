# Pansys: demo y pruebas de software

Guía para ejecutar Pansys en una prueba con evaluadores **usando solo la base `pansys_test`**.
Nunca use `pansys_db` en una demo.

## Cómo funciona el modo demo

| Variable | Efecto |
|---|---|
| `PANSYS_MODO_DEMO=1` | Antes de aceptar peticiones, el backend comprueba que `DB_NAME` sea exactamente `pansys_test` **y** que la conexión real apunte a `pansys_test` (`SELECT DATABASE()`). Si no, muestra `Arranque cancelado: ...` y termina sin escuchar en ningún puerto. Nunca cambia la base por su cuenta. |
| `PANSYS_SERVIR_FRONTEND=1` | Express sirve `frontend/build`: la interfaz y la API comparten puerto y origen (no hace falta CORS). Las rutas `/api/...` siguen siendo de la API; el resto de rutas sin extensión devuelven `index.html`. Si el build no existe, el arranque se cancela. |

Valores que activan cada opción: `1`, `true`, `si` o `sí`. Sin ellas, el backend funciona igual que siempre.

El `.env` del backend apunta a `pansys_db`. Las variables definidas en la terminal tienen prioridad
sobre el `.env`, así que la demo se configura en la terminal y el `.env` no se toca.

## Requisitos previos

- `pansys_test` con el esquema actual (001–004) y cuentas de prueba con contraseña conocida
  (las de la semilla usan `'!'` y **no pueden iniciar sesión**).
- Recomendado: un usuario de MySQL con permisos **solo** sobre `pansys_test` y un `JWT_SECRET`
  distinto del de producción.
- No ejecutar las suites de `backend/pruebas/` durante la demo: borran y recrean datos.

## Pasos (PowerShell)

1. Compilar el frontend (la API queda con rutas relativas, sin IP ni dominio fijos):

   ```powershell
   cd frontend
   node scripts/compilar-demo.js
   ```

2. En una terminal nueva, arrancar el backend en modo demo. Las variables solo existen en esa terminal:

   ```powershell
   cd backend
   $env:PANSYS_MODO_DEMO = '1'
   $env:PANSYS_SERVIR_FRONTEND = '1'
   $env:DB_NAME = 'pansys_test'
   # Secreto propio de la demo, aleatorio y distinto del de producción:
   $b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   $env:JWT_SECRET = [Convert]::ToBase64String($b)
   # Si existe un usuario de MySQL exclusivo para pansys_test:
   # $env:DB_USER = '<usuario_de_pruebas>'
   # $env:DB_PASSWORD = '<se escribe aquí, nunca en un archivo del repositorio>'
   npm start
   ```

   Debe mostrar `Modo demo: base pansys_test verificada ✅` y `Sirviendo el frontend compilado ...`.
   Use `npm start` (no `npm run dev`) para que nodemon no reinicie el servidor durante la prueba.

3. Comprobar que apunta a `pansys_test` (solo lectura, en MySQL Workbench):

   ```sql
   SELECT ID, USER, HOST, DB, COMMAND, TIME FROM information_schema.PROCESSLIST
   WHERE DB IN ('pansys_db', 'pansys_test');
   ```

   Las conexiones del backend deben mostrar `DB = pansys_test` y ninguna `pansys_db`.
   Otra comprobación: iniciar sesión con una cuenta que solo exista en `pansys_test`.

4. Acceso:
   - **Mismo equipo:** `http://localhost:3000`
   - **Misma red local:** `http://<IP-del-equipo>:3000` (ver la IP con `ipconfig`; requiere una regla
     de entrada en el firewall de Windows para el puerto 3000, solo en el perfil «Privado»).
   - **Enlace público:** un túnel hacia `http://localhost:3000` (por ejemplo, Cloudflare Tunnel).
     Solo se expone ese puerto; **MySQL nunca se expone a internet**.

5. Al terminar: `Ctrl+C` en la terminal del backend (y cerrar el túnel, si se usó).
   Al cerrar esa terminal desaparecen también las variables de la demo.

## Desarrollo normal (sin modo demo)

`npm run dev` en `backend/` y `npm start` en `frontend/` (puerto 3001), como siempre.
