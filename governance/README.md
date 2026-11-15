# governance/

Carpeta vacía en el repositorio. En el build, `scripts/fetch-governance.mjs` coloca aquí:

- `runtime.md`: el prompt operativo de FromE Chat, descargado de un repositorio privado
  con la variable de entorno `GOVERNANCE_TOKEN`.
- `pipeline.json`: la definición del ciclo por etapas (orden, condiciones y textos), del
  mismo repositorio privado.
- `fingerprints.json`: huellas multilingües que usa el filtro de salida.
- `canary.json`: marcas canario generadas para ese despliegue.
- `seal.key`: clave del estado sellado, generada para ese despliegue.

Nada de esto se versiona. El prompt operativo y el ciclo son obras no publicadas de Volyen Project SL.
