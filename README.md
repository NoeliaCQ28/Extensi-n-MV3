# Reto Krowdy - Agrupacion y analisis de productos

## Criterio de similitud
Para agrupar productos similares se utiliza un criterio propio basado en texto:

1. Normalizacion del titulo y marca: minusculas, sin acentos, solo caracteres alfanumericos.
2. Tokenizacion por palabras, eliminando stop-words comunes (de, la, con, pack, set, etc.).
3. Similaridad = 0.6 * Jaccard + 0.4 * Coverage, con un bono si coincide la marca.
   - Jaccard: interseccion / union de tokens.
   - Coverage: interseccion / min(tamano de tokens).
4. Umbral de agrupacion: 0.58. Si el mejor puntaje supera el umbral, se asigna al grupo.
5. Clustering greedy: se recorre la lista y se asigna al mejor grupo disponible; si no hay, se crea uno nuevo.

## Metricas y ranking
Por cada grupo se calcula:
- Conteo por sitio (Falabella y MercadoLibre).
- Precio minimo, maximo, promedio y mediana.
- Comparacion de precios: se usa el precio minimo por sitio y se determina el sitio mas barato.
- Ahorro estimado: diferencia entre minimos de ambos sitios.
- Ranking: grupos con ahorro positivo ordenados de mayor a menor.

## Limitaciones
- La similitud es textual; no entiende sinonimos ni variaciones semanticas.
- Titulo incompleto o mal scrapeado reduce la calidad del agrupamiento.
- El clustering greedy puede crear grupos suboptimos si el orden de entrada es adverso.
- No se detectan variantes (color, capacidad, bundle) si no aparecen claramente en el titulo.
- La comparacion de precios depende de `precioNumerico`; si falta en un sitio, no hay ahorro.
- Se asume moneda uniforme (S/) y no se ajusta por cambios de moneda o envios.
