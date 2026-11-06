# SynthesisOne Backend 2.2.4 — SO Assistant conversational upgrade

## Cambios

- SO Assistant recibe instrucciones más concretas para conversar con naturalidad, mantener el hilo, evitar respuestas repetitivas y ajustar la extensión a la pregunta.
- Se refuerzan los cálculos comerciales orientativos para Reseller: coste, ingreso bruto, beneficio, margen y escenarios, siempre a partir de datos entregados y sin inventar precios ni disponibilidad.
- El asistente recibe reglas explícitas para no afirmar que consultó APIs externas ni que ejecutó acciones que la aplicación no haya confirmado.
- El límite predeterminado de salida pasa de 650 a 1400 tokens para permitir respuestas y cálculos más completos. Se mantiene el tope configurable de 4096 tokens y los límites de uso diarios actuales.

## Compatibilidad y seguridad

No se modifican autenticación, licencias, compras, pagos, Wallet, catálogo ni integraciones de proveedores. No se incorpora el nuevo proveedor de reventa: queda aplazado hasta que se investigue y apruebe. Se conserva el formato JSON del asistente y el filtrado de contenido de salida.

## Validación

`npm test` — 238 pruebas aprobadas.
