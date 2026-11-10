# FromE Chat

Interfaz abierta de trabajo con modelos de frontera gobernada por la arquitectura From E™ (Open Core v2.0).

- Gratuita, sin cuenta y sin suscripción: cada usuario paga sus tokens al proveedor con su propia clave de API.
- La arquitectura se aplica en servidor y nunca llega al navegador (ver «Protección de la arquitectura»).
- La clave del usuario se usa en la llamada al proveedor y se descarta: no se almacena ni se registra.
- Comparador opcional: misma pregunta con y sin From E™, lado a lado.
- Sesiones anonimizadas para investigación solo con consentimiento explícito (Netlify Blobs, con hash SHA-256 por turno).

## Estructura

```
public/               web estática (portada, /chat/, /privacidad/)
netlify/functions/    chat.mjs (streaming), models.mjs
  lib/governance.mjs  carga el prompt operativo y prepara el material del filtro
  lib/gate.mjs        clasificador de entrada
  lib/shield.mjs      filtro de salida y detección heurística
  lib/consent.mjs     sesiones consentidas
governance/           vacía en el repositorio; se rellena en el build (scripts/fetch-governance.mjs)
tests/                pruebas con material de sustitución (tests/fixtures/)
```

## Protección de la arquitectura

El prompt operativo no está en este repositorio y no contiene la arquitectura: son reglas de
conducta para la ejecución. Con la arquitectura activa, cada turno pasa por tres capas:

1. **Entrada.** Un clasificador decide si el mensaje busca las instrucciones del sistema. Si es
   así, ese turno se responde por una ruta pública en la que el modelo no recibe el prompt operativo.
2. **Prompt mínimo.** Lo que el modelo recibe no incluye definiciones, fórmulas ni nombres internos.
3. **Salida.** El servidor retiene el final de la respuesta mientras se genera y la corta si
   reproduce el prompt (literal, con símbolos intercalados, invertido, cifrado o codificado), si
   contiene una marca canario del despliegue o si acumula huellas de una traducción o paráfrasis.

Además hay un límite de peticiones por IP. Este código es público a propósito: la protección no
depende de ocultarlo. Ninguna de estas capas es infalible por separado.

## Desarrollo local

```bash
npm install
npx netlify dev
```

Abre http://localhost:8888/chat/ y pega una clave de API de Anthropic (`sk-ant-…`).

## Despliegue

Netlify, enlazado a este repositorio. Publica `public/`, funciones en `netlify/functions/`. Dominio previsto: `chat.frome-one.com`.

Variable de entorno obligatoria en Netlify: `GOVERNANCE_TOKEN`, un token de GitHub de solo lectura sobre el repositorio privado que contiene el prompt operativo. El build lo descarga a `governance/`, genera las marcas canario del despliegue y lo empaqueta con la función; nada de eso se versiona aquí.

## Licencias

- Especificaciones Open Core de From E™: publicadas como trabajo científico (DOI 10.5281/zenodo.19041459); su texto operativo no se distribuye en este repositorio.
- Código de FromE Chat: © Volyen Project SL. Todos los derechos reservados salvo indicación expresa.
- From E™, Internal Editor™, Extreme Thinking™, Symbolic Echo Cleaner™, Constructive Loop™ y Core Self-Validator™ son marcas de Volyen Project SL.

Especificación: https://doi.org/10.5281/zenodo.19041459 · Servicios: https://frome-one.com
