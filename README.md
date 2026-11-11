# FromE Chat

Banco de pruebas abierto de la arquitectura de gobernanza From E™ sobre modelos de frontera.

- Sin cuenta y sin suscripción: cada usuario paga sus tokens al proveedor con su propia clave de API.
- Comparador en el centro: el mismo mensaje y el mismo modelo, con y sin From E™, lado a lado.
- Con From E™ activa, cada respuesta recorre en servidor un ciclo de varias llamadas y la interfaz muestra la traza de etapas.
- Módulos: el usuario enciende o apaga cada módulo de trabajo. El servidor compone el texto de cada etapa solo con los activos; sus nombres son públicos, sus textos no.
- La arquitectura se ejecuta en servidor y nunca llega al navegador (ver «Protección de la arquitectura»).
- La clave del usuario se usa en cada llamada al proveedor y se descarta: no se almacena ni se registra.
- Primera fase sin historial, sin proyectos y sin cuentas: la conversación vive en el navegador.
- Sesiones aportadas a la medición solo con consentimiento explícito (Netlify Blobs, con hash SHA-256 por turno).

## Estructura

```
public/               web estática (portada, /chat/, /privacidad/)
netlify/functions/    chat.mjs (una etapa del ciclo por invocación), models.mjs
  lib/engine.mjs      motor genérico de ciclos: plantillas, reglas de paso, ejecución de una etapa
  lib/seal.mjs        estado sellado entre etapas (AES-256-GCM)
  lib/anthropic.mjs   llamadas al proveedor con la clave del usuario
  lib/governance.mjs  carga el prompt operativo y el ciclo, y prepara el material del filtro
  lib/gate.mjs        clasificador de entrada
  lib/shield.mjs      filtro de salida y detección heurística
  lib/consent.mjs     sesiones consentidas
governance/           vacía en el repositorio; se rellena en el build (scripts/fetch-governance.mjs)
tests/                pruebas con material de sustitución (tests/fixtures/), sin relación con el real
```

## Protección de la arquitectura

Ni el prompt operativo ni la definición del ciclo están en este repositorio. Lo que hay aquí es un
motor genérico: no contiene ninguna etapa, ni su orden, ni sus condiciones, ni sus textos. Con la
arquitectura activa, cada mensaje pasa por cuatro capas:

1. **Entrada.** Un clasificador decide si el mensaje busca las instrucciones del sistema. Si es
   así, se responde por una ruta pública en la que el modelo no recibe ni el prompt operativo ni
   ninguna etapa del ciclo.
2. **Prompt mínimo.** Lo que el modelo recibe en cada llamada no incluye definiciones, fórmulas ni
   nombres internos.
3. **Ciclo repartido.** La respuesta se construye en varias llamadas separadas. Cada llamada ve solo
   su etapa; ninguna contiene el ciclo completo. La función ejecuta una etapa por invocación y
   devuelve el estado intermedio sellado (cifrado y autenticado con una clave que se genera en cada
   despliegue, ligado a la conversación y con caducidad): el navegador lo reenvía sin poder leerlo,
   alterarlo ni reutilizarlo.
4. **Salida.** Solo se entrega el resultado final, y antes se comprueba contra todo el material
   propio (prompt operativo y textos de cada etapa): literal, con símbolos intercalados, invertido,
   cifrado o codificado, marcas canario del despliegue y huellas de traducción o paráfrasis. Los
   borradores y las notas intermedias no salen del servidor en claro.

Además hay un límite de peticiones por IP. Este código es público a propósito: la protección no
depende de ocultarlo. Ninguna de estas capas es infalible por separado.

Netlify limita cada ejecución a 60 segundos; por eso el ciclo avanza una etapa por petición y cada
llamada deja de leerse antes de ese límite.

Los modelos ofrecidos piensan antes de responder y no envían texto mientras lo hacen; ese tiempo y
esos tokens cuentan dentro de cada llamada. En esta fase todas las llamadas, la directa y las del
ciclo, piden el nivel mínimo de razonamiento previo (`output_config.effort`, variable `MODEL_EFFORT`,
por defecto `low`). Si un modelo rechaza el parámetro, la llamada se repite sin él.

## Entrada de pruebas

`/api/selftest` lanza un caso (mensaje y módulos) en servidor y devuelve en texto plano la
respuesta gobernada y la directa. Solo existe en vistas previas y ramas, nunca en producción, y
solo si están definidas `SELFTEST_KEY` (clave de API de quien prueba, marcada como secreta) y
`SELFTEST_TOKEN` (contraseña de la entrada). Sin eso responde 404. Tiene tope diario de casos
(`SELFTEST_DAILY_CAP`, 80 por defecto). Para retirarla basta con borrar las variables.

Los parámetros van en la consulta (`?t=&id=&m=&q=`) o en la ruta, para lectores que no
conservan la consulta:

```
/api/selftest/status/<contraseña>
/api/selftest/<contraseña>/<id>/<módulos>/<pregunta en base64url>/<modelo o ->/<gov|base|->/<n>
```

En la ruta, los módulos van separados por punto (`todos` usa los de por defecto, `ninguno`
no activa ninguno). Un caso es un trabajo reanudable: cada petición avanza las etapas que
caben en una ejecución, guarda el estado sellado y devuelve lo que hay; mientras no termina,
la respuesta acaba en `=== EN CURSO` y se vuelve a pedir cambiando `<n>`. El mismo caso
(mismo id, módulos, modelo y pregunta) no se ejecuta dos veces.

## Desarrollo local

```bash
npm install
npx netlify dev
```

Abre http://localhost:8888/chat/ y pega una clave de API de Anthropic (`sk-ant-…`).

## Despliegue

Netlify, enlazado a este repositorio. Publica `public/`, funciones en `netlify/functions/`. Dominio previsto: `chat.frome-one.com`.

Variable de entorno obligatoria en Netlify: `GOVERNANCE_TOKEN`, un token de GitHub de solo lectura sobre el repositorio privado que contiene el prompt operativo y la definición del ciclo. El build los descarga a `governance/`, genera las marcas canario y la clave de sellado del despliegue y lo empaqueta todo con la función; nada de eso se versiona aquí.

## Licencias

- Especificaciones Open Core de From E™: publicadas como trabajo científico (DOI 10.5281/zenodo.19041459); su texto operativo no se distribuye en este repositorio.
- Código de FromE Chat: © Volyen Project SL. Todos los derechos reservados salvo indicación expresa.
- From E™, Internal Editor™, Extreme Thinking™, Symbolic Echo Cleaner™, Constructive Loop™ y Core Self-Validator™ son marcas de Volyen Project SL.

Especificación: https://doi.org/10.5281/zenodo.19041459 · Servicios: https://frome-one.com
