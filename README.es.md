# Hey Claude 🎙️

**Habla con Claude Code. Manos libres. Desde el navegador. Sin API keys.**

Di *"Hey Claude"* en voz alta — el agente suena, te escucha y se pone a trabajar en tu proyecto mientras ves cada paso de su razonamiento en un pipeline en vivo. Hasta puede reescribir **su propia interfaz** si se lo pides.

> 🇬🇧 [Read in English](README.md)

## Por qué es diferente

- **Manos libres**: activa *Hey Claude* en ajustes, deja la pestaña en segundo plano y simplemente habla. Sonido de activación + destello del orbe + notificación de escritorio.
- **Ve tu pantalla**: pulsa el botón de pantalla y comparte una ventana o el escritorio (el mismo selector que Meet/Zoom). Cada cosa que digas lleva una captura fresca de lo que estás viendo — *"Hey Claude, ¿qué es este error?"* simplemente funciona. Y el agente puede **volver a mirar él solo** a mitad de tarea (pide una captura nueva por el puente cuando la necesita).
- **Ve a tu agente pensar**: un pipeline en tiempo real muestra cada herramienta (lecturas, ediciones, comandos, sub-agentes) con su duración — como la terminal de Claude Code, pero bonita.
- **Se autogestiona**: al arrancar inyecta contexto en el `CLAUDE.md` de tu proyecto, así Claude sabe que esta web existe y puede modificarla cuando se lo pidas ("haz el orbe más grande") — el agente edita su propio código.
- **Control total**: dictado con revisión antes de enviar (o auto-envío), botón de Stop que aborta al agente a mitad de razonamiento, sesiones con historial, explorador de ficheros, adjuntos arrastrando.
- **Coste cero sobre tu suscripción de Claude**: el reconocimiento y las voces son del navegador (Web Speech API). El cerebro es tu CLI `claude` ya autenticado.

## Para qué lo usas

Es **Claude Code, nativo, por voz** — corriendo dentro de un workspace real, así que no solo responde: *construye*.

- **Levanta un proyecto hablando.** *"Créame una landing con una sección de precios y despliégala."* Escribe los ficheros, ejecuta los comandos y te avisa cuando está online — y ves cada paso en el pipeline.
- **Desatáscate con el código, sin manos.** *"Lee este módulo y dime por qué falla el test."* Ideal para pensar en voz alta mientras das vueltas por la habitación.
- **Deja que vea lo que ves.** Comparte pantalla y lee el error que tienes delante, te ayuda con un proyecto visual o de diseño, revisa una interfaz mientras haces scroll — o juega contigo: comparte una partida y que te dé estrategia, narre o reaccione a lo que pasa.
- **Crea mientras vives.** Cocina, pasea, dibuja — y mantén un constructor de fondo que convierte frases en software que funciona.

Como corre en *tu* carpeta con *tu* `CLAUDE.md` y tus skills, todo lo que hace Claude Code lo puede hacer ahora por voz.

## Arranque rápido

Requisitos: [Node.js 18+](https://nodejs.org), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`, con sesión iniciada), Chrome o Edge.

```bash
# 1. Suelta la carpeta en la raíz de tu proyecto
git clone https://github.com/Setroc95/hey-claude.git
cd tu-proyecto && cp -r ../hey-claude .

# 2. Arranca
bash hey-claude/start.sh        # Windows: doble clic en start.bat

# 3. Abre http://localhost:8765 en Chrome/Edge
#    → engranaje → activa "Hey Claude" → habla.
```

> **¿Ya usas Claude Code en VS Code?** Estás logueado — el CLI comparte esa sesión, así que **sin re-login**. Y `start.bat` / `start.sh` te instalan Node.js y el CLI de Claude Code solos si faltan.

El servidor ejecuta `claude` en la **carpeta padre** (tu proyecto): hereda tu `CLAUDE.md`, tus skills y tu configuración MCP. ¿Otro proyecto? Ajustes → **Sistema** → **Examinar** y eliges cualquier carpeta — el agente se reinicia en ese workspace y sigue con su contexto allí.

## Modelos

Eliges el modelo en Ajustes → **Sistema** igual que con `/model` en el CLI: las opciones son los **alias reales del CLI** — `default` (el de tu cuenta), `opus`, `sonnet`, `haiku` — más un campo libre para escribir un nombre exacto. Nada inventado: resuelve a lo que ofrezca tu versión instalada de Claude Code.

## Límites honestos y seguridad (léelo)

- **La inyección de prompts es real.** El agente lee cosas no confiables — tu pantalla compartida, ficheros adjuntos, el contenido de tu workspace. Una instrucción maliciosa escondida ahí podría hacerle ejecutar comandos o filtrar datos. El modo por defecto es `bypassPermissions` (autonomía total — lo que lo hace potente), así que **úsalo en código/proyectos de confianza**. Para código no confiable usa `plan` (solo lectura) desde Ajustes → Sistema. `VOICE_TRIPWIRE=1` detecta comandos obviamente destructivos, pero **no es un sandbox**.
- **Sin auth por defecto — mantenlo en localhost.** Ningún endpoint pide credenciales y el servidor escucha solo en `127.0.0.1` (seguro en local). Si lo expones (Tailscale Serve, un túnel, `VOICE_HOST=0.0.0.0`), **define `VOICE_TOKEN=<secreto>`** y abre la URL con `?token=<secreto>`. Sin eso, cualquiera que llegue tiene un agente sin auth que ejecuta comandos como tú. Nunca uses `tailscale funnel` (internet público) sin token.
- El wake word usa el reconocimiento del navegador: **mantén la pestaña abierta** (puede estar en segundo plano). El indicador del micro queda visible — requisito del navegador, no un bug.
- El reconocimiento de Chrome/Edge tira de la nube de Google/Microsoft; sin internet se degrada.
- En móvil el wake word es experimental.
- Al arrancar escribe un bloque marcado en el `CLAUDE.md` de tu proyecto (para que el agente sepa que esta UI existe). Es idempotente; desactívalo con `VOICE_NO_CLAUDEMD=1`.

## Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `VOICE_PORT` | `8765` | Puerto |
| `VOICE_MODEL` | `default` | `default`/`opus`/`sonnet`/`haiku` o un nombre de modelo completo |
| `VOICE_PERMISSION_MODE` | `bypassPermissions` | `plan` (solo lectura) / `acceptEdits` / `bypassPermissions` |
| `VOICE_TOKEN` | _(vacío)_ | Si se define, todo exige token — **úsalo al exponer en remoto** |
| `VOICE_TRIPWIRE` | `0` | `1` = detección best-effort de comandos destructivos |
| `VOICE_WORKSPACE` | carpeta padre | Dónde corre Claude |
| `VOICE_NO_CLAUDEMD` | `0` | `1` = no escribir el bloque en `CLAUDE.md` |

Todo esto se cambia también en vivo desde Ajustes → **Sistema** (modelo, permisos, workspace), persistido en `voice-config.json`. Atajos: **Espacio** = mantener para hablar, **Escape** = detener.

## Uso remoto / VPS

Córrelo en un servidor headless y accede con [Tailscale Serve](https://tailscale.com/kb/1312/serve) o un túnel SSH (`ssh -L 8765:localhost:8765 user@host`). El micro exige HTTPS o localhost.

⚠️ **Exponerlo = poner token.** En cuanto sea accesible más allá de localhost, arráncalo con `VOICE_TOKEN=<secreto>` y abre `https://tu-host/?token=<secreto>`.

## Lo que viene

Esto es solo el principio:

- **Compañero móvil por Tailscale** — controla el entorno de desarrollo de tu PC desde el móvil, en cualquier sitio. Programa en el coche, en el gym, lejos del escritorio: tú hablas y la máquina de casa lo construye.
- Más integraciones, más idiomas en la interfaz, voz on-device opcional y motores de wake word enchufables.

Tus ideas y PRs deciden lo próximo.

## Contribuir

PRs bienvenidas — mira [CONTRIBUTING.md](CONTRIBUTING.md).

## Por qué existe esto

Durante cincuenta años el teclado se ha interpuesto entre lo que imaginamos y lo que enviamos. Pensamos en ideas y escribimos en sintaxis — y según los modelos se volvían más rápidos, el cuello de botella dejó de ser la máquina y pasó a ser el acto de teclear.

Hey Claude intenta tirar ese muro. Hablas, le enseñas el problema con tu pantalla, y un agente que de verdad *hace cosas* construye a tu lado — sin abrir un IDE, sin manos en el teclado. Empezó como una herramienta que quería para mí y se convirtió en algo que creo que mucha gente necesita: una forma de crear que se adapta a tu vida en vez de atarte a una mesa.

Es open source a propósito. Cómo le hablamos a nuestros ordenadores no debería ser de una sola empresa — debería ser de quien quiera construirlo. Si te resuena, [abre un PR](CONTRIBUTING.md). Cada aportación empuja la idea entera hacia delante.

Si te ahorró tiempo o te sacó una sonrisa, una ⭐ ayuda de verdad a que llegue a la siguiente persona.

## Licencia

[MIT](LICENSE)
