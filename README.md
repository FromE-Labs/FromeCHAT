# FromE Chat

Interfaz abierta de trabajo con modelos de frontera gobernada por la arquitectura From E™ (Open Core v2.0).

- Gratuita, sin cuenta y sin suscripción: cada usuario paga sus tokens al proveedor con su propia clave de API.
- La arquitectura se compone en servidor (`netlify/functions/chat.mjs` + `governance/`) y nunca llega al navegador.
- La clave del usuario se usa en la llamada al proveedor y se descarta: no se almacena ni se registra.
- Comparador opcional: misma pregunta con y sin From E™, lado a lado.
- Sesiones anonimizadas para investigación solo con consentimiento explícito (Netlify Blobs, con hash SHA-256 por turno).

## Estructura

```
public/               web estática (portada, /chat/, /privacidad/)
netlify/functions/    chat.mjs (streaming), models.mjs, lib/governance.mjs, lib/consent.mjs
governance/           vacía en el repositorio; los 7 módulos Open Core se descargan en el build (scripts/fetch-governance.mjs)
```

## Desarrollo local

```bash
npm install
npx netlify dev
```

Abre http://localhost:8888/chat/ y pega una clave de API de Anthropic (`sk-ant-…`).

## Despliegue

Netlify, enlazado a este repositorio. Publica `public/`, funciones en `netlify/functions/`. Dominio previsto: `chat.frome-one.com`.

Variable de entorno obligatoria en Netlify: `GOVERNANCE_TOKEN`, un token de GitHub de solo lectura sobre el repositorio privado que contiene las especificaciones Open Core. El build las descarga a `governance/` y las empaqueta con la función; no se versionan aquí.

## Licencias

- Especificaciones Open Core de From E™: publicadas como trabajo científico (DOI 10.5281/zenodo.19041459); su texto operativo no se distribuye en este repositorio.
- Código de FromE Chat: © Volyen Project SL. Todos los derechos reservados salvo indicación expresa.
- From E™, Internal Editor™, Extreme Thinking™, Symbolic Echo Cleaner™, Constructive Loop™ y Core Self-Validator™ son marcas de Volyen Project SL.

Especificación: https://doi.org/10.5281/zenodo.19041459 · Servicios: https://frome-one.com
