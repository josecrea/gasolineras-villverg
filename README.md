# ⛽ Gasolineras · okservice

Mapa diario de precios de carburante en Canarias para las furgonetas de okservice
(VILLVERG SL), con la vista por defecto en el **sur de Tenerife**.

- **Fuente:** API pública del Ministerio para la Transición Ecológica (Geoportal de carburantes),
  provincias 38 y 35.
- **Qué enseña:** la gasolinera más barata del sur, la más barata donde vale la **tarjeta SOLRED**
  (red Repsol / Campsa / Petronor), el ahorro por depósito de 60 L frente a la media, un mapa
  con colores por cuartil y el top 15 con la variación respecto al día anterior.
- **Cómo se actualiza:** GitHub Actions cada mañana (`.github/workflows/actualizar.yml`) ejecuta
  `node generar.mjs` y publica `docs/` en GitHub Pages. Sin dependencias ni servidor.
- **Seguridad:** si el Ministerio falla o devuelve menos de 300 estaciones, el proceso se para
  y deja publicado lo del día anterior.

Ficheros generados:

| Fichero | Para qué |
|---|---|
| `docs/index.html` | la página (mapa + tabla) |
| `docs/resumen.json` | resumen del sur de Tenerife, para los bots |
| `datos/historico.csv` | una foto diaria por estación (`fecha,id,gasoleo,g95`) |

En local: `node generar.mjs` (Node 20 o superior).

Código propio; la idea viene de un proyecto público similar. Los datos son del Ministerio.
