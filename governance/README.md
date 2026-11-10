# governance/

Carpeta vacía en el repositorio. En el build, `scripts/fetch-governance.mjs` coloca aquí:

- `runtime.md`: el prompt operativo de FromE Chat, descargado de un repositorio privado
  con la variable de entorno `GOVERNANCE_TOKEN`.
- `fingerprints.json`: huellas multilingües que usa el filtro de salida.
- `canary.json`: marcas canario generadas para ese despliegue.

Nada de esto se versiona. El prompt operativo es una obra no publicada de Volyen Project SL.
