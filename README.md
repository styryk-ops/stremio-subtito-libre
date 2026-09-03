# Subtito Libre — Addon de Stremio

Traduce subtitulos en ingles (bien sincronizados, de OpenSubtitles) al espanol
usando Gemini, Mistral o Grok con tus propias API keys, gratis, con fallback
automatico si una API se queda sin cuota.

Esta version se publica en internet con una URL fija (`https://tu-addon.onrender.com`),
asi que funciona igual desde la Smart TV, el celular, o cualquier dispositivo,
sin tener que averiguar ni fijar la IP de tu PC. La PC ni siquiera necesita
estar prendida: el addon corre en el servidor de Render, no en tu casa.

## Que vamos a hacer

1. Subir el codigo a GitHub (gratis)
2. Conectar ese repositorio a Render (hosting gratis)
3. Configurar las API keys ahi
4. Usar la URL publica que te da Render en Stremio, en cualquier dispositivo

Todo desde PowerShell, paso a paso.

---

## Paso 1: Instalar Git (si no lo tenes)

```powershell
git --version
```

Si da error de "no reconocido":

```powershell
winget install --id Git.Git -e --source winget
```

Cerra y volve a abrir PowerShell despues de instalar.

## Paso 2: Instalar Node.js (si no lo tenes)

```powershell
node -v
```

Si da error:

```powershell
winget install OpenJS.NodeJS.LTS
```

De nuevo, cerra y volve a abrir PowerShell.

## Paso 3: Armar la carpeta del proyecto

```powershell
cd $HOME
mkdir stremio-subtito-libre
cd stremio-subtito-libre
```

Copia ahi adentro todos los archivos que te pase (`server.js`, `package.json`,
`.env.example`, `.gitignore`, y la carpeta `lib/` con sus tres archivos),
respetando esta estructura:

```
stremio-subtito-libre/
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── lib/
    ├── srt.js
    ├── translate.js
    └── opensubtitles.js
```

## Paso 4: Probarlo local antes de publicar (opcional pero recomendado)

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Completa tus keys de Gemini/Mistral/Grok en el bloc de notas, guarda y cerra.

```powershell
npm start
```

Si ves `Addon corriendo en http://127.0.0.1:7000/manifest.json` sin errores,
anda bien. Frena el proceso con `Ctrl+C` y segui al paso 5.

## Paso 5: Crear cuenta en GitHub

Si no tenes cuenta, creala gratis en https://github.com/join

## Paso 6: Crear el repositorio en GitHub

1. Entra a https://github.com/new
2. Nombre del repo: `stremio-subtito-libre`
3. Dejalo en **Private** (privado) — no hace falta que sea publico
4. NO tildes "Add a README" (ya tenemos uno)
5. Creá el repositorio

GitHub te va a mostrar comandos; no hace falta que los copies, seguimos con
los de abajo.

## Paso 7: Subir el codigo desde PowerShell

Reemplaza `TU-USUARIO` por tu usuario de GitHub:

```powershell
cd $HOME\stremio-subtito-libre
git init
git add .
git commit -m "Primera version del addon"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/stremio-subtito-libre.git
git push -u origin main
```

Te va a pedir login de GitHub (se abre el navegador, autorizas, listo).

**Importante:** el `.gitignore` ya excluye tu archivo `.env`, asi que tus API
keys NO se suben a GitHub. Eso esta bien y es a proposito — las vas a cargar
directo en Render en el paso siguiente.

## Paso 8: Crear cuenta en Render

Andá a https://render.com y registrate gratis (podes usar tu cuenta de GitHub
para entrar directo, es lo mas comodo).

## Paso 9: Crear el Web Service

1. En el dashboard de Render, click en **New +** -> **Web Service**
2. Conecta tu cuenta de GitHub si te lo pide, y elegi el repo `stremio-subtito-libre`
3. Completa:
   - **Name**: `subtito-libre` (o el nombre que quieras, forma parte de tu URL final)
   - **Region**: la mas cercana (Ohio o Sao Paulo suelen ser las mejores para Argentina)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**

## Paso 10: Cargar las API keys en Render

Antes de crear el servicio (o despues, en la seccion **Environment** del
servicio ya creado), agrega estas variables de entorno:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | tu key de Gemini |
| `MISTRAL_API_KEY` | tu key de Mistral |
| `GROK_API_KEY` | tu key de Grok |
| `TARGET_LANG` | `spa` |
| `SOURCE_LANG` | `eng` |

No hace falta que cargues `PORT` — Render la define solo.

Click en **Create Web Service** (o **Save Changes** si ya estaba creado).

## Paso 11: Esperar el deploy

Render va a instalar dependencias y arrancar el addon. Se ve un log en vivo;
cuando diga algo como `Addon corriendo en http://...` (el puerto va a ser
distinto, pero el mensaje confirma que arrancó bien), ya está listo.

Arriba del todo del panel vas a ver tu URL publica, algo asi:

```
https://subtito-libre.onrender.com
```

## Paso 12: Instalar en Stremio (Smart TV, celular, PC — cualquiera)

En el buscador de addons de Stremio (en la TV, en el celu, donde sea), pega:

```
https://subtito-libre.onrender.com/manifest.json
```

Anda igual en todos los dispositivos porque es una URL de internet, no una IP
de tu red de casa.

---

## Notas importantes

- **Plan gratis de Render "se duerme"**: si el addon no recibe pedidos por 15
  minutos, Render lo apaga para ahorrar recursos. El primer pedido despues de
  estar dormido tarda unos 30-50 segundos extra en responder (se está
  "despertando"). Los pedidos siguientes van normales. Es la unica
  contra de que sea gratis.
- **Cache y reinicios**: en el plan free, el disco no es permanente — cada vez
  que Render reinicia o redeploya el servicio, la carpeta `cache/` se vacía y
  los subtitulos ya traducidos se vuelven a traducir la primera vez que se
  piden de nuevo. No rompe nada, solo gasta unos tokens de mas en esos casos.
- **Actualizar el addon a futuro**: si mas adelante cambias algo del codigo,
  el flujo es: editar los archivos localmente -> `git add .` -> `git commit -m "cambio"`
  -> `git push`. Render redeploya solo cuando detecta el push.
- **Cambiar API keys**: se hace desde el dashboard de Render (seccion
  Environment del servicio), sin tocar PowerShell ni el codigo.
