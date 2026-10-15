# Auditor RIMAC

Página donde subes una pieza gráfica (PNG, JPG o PDF) y recibe una calificación con los lineamientos del RIDE System, con el mismo formato y criterios del skill `/rimac-branding`.

- Puntaje general sobre 10: identidad visual (60%) y copy y tono de voz (40%).
- Fotografía y composición, si la pieza la tiene.
- Sugerencias concretas para corregirla y propuestas de copy.
- Aplica RIDE Brand (marketing, redes, impresos) o RIDE Interface (producto digital, web, app), según la pieza.

## Cómo funciona

```
public/          Frontend estático (index.html, styles.css, app.js)
api/audit.js     Función de Vercel: recibe la pieza, llama a la API de Anthropic y devuelve la calificación
lib/prompt.js    Lineamientos del skill /rimac-branding que usa la función
test/            Pruebas de la función con la API de Anthropic simulada
artifact/        Versión original para claude.ai (usa el permiso de Claude de la página, sin servidor)
```

La clave de Anthropic vive solo en el servidor. El navegador nunca la ve, y los lineamientos del prompt tampoco viajan al navegador.

## Publicar en Vercel

1. En [vercel.com/new](https://vercel.com/new), importa este repositorio. No hay build: Vercel toma `public/` como sitio y `api/` como funciones.
2. En **Settings → Environment Variables** agrega:

   | Variable | Para qué |
   |---|---|
   | `ANTHROPIC_API_KEY` | Obligatoria. Clave de la API de Anthropic. Cada revisión se cobra a esa cuenta. |
   | `ACCESS_CODE` | Recomendada. Código que debe escribir quien use la página. Sin él, cualquiera con el link gasta tu crédito. |
   | `MODEL_DEFAULT` | Opcional. Por defecto `claude-sonnet-5-5`. |
   | `MODEL_COMPLEX` | Opcional. Por defecto `claude-opus-5-5`. Se usa en el análisis a fondo. |

3. Vuelve a desplegar (Redeploy) para que tome las variables.
4. Cada rama y cada pull request genera una URL de prueba (preview) automáticamente.

## Probar en tu computador

```bash
npm i -g vercel
cp .env.example .env.local      # completa ANTHROPIC_API_KEY y ACCESS_CODE
vercel dev
```

Pruebas de la función, sin gastar crédito:

```bash
npm test
```

## Cambiar los lineamientos

Los criterios están en `lib/prompt.js`. Si el skill `/rimac-branding` cambia, actualiza ese archivo. El formato de salida (JSON) y los umbrales de color están en `public/app.js`:

- 0 a 6.9: no cumple. 7.0 a 7.9: cumple parcialmente. 8.0 a 10: cumple.
- Barras por sección: rojo bajo 70%, amarillo de 70% a 79%, verde desde 80%.

## Límites a tener en cuenta

- Vercel limita el cuerpo de la petición a unos 4.5 MB. El navegador reduce las imágenes a 1600 px (JPEG) antes de enviarlas. Los PDF se revisan hasta la página 5.
- La función espera hasta 55 segundos la respuesta de Anthropic (`maxDuration` de 60 s en `vercel.json`).
- Se califica desde una imagen: los HEX y las fuentes exactas son estimaciones visuales.
- Este repositorio contiene los lineamientos del RIDE System dentro del prompt. Si es público, cualquiera puede leerlos. Considera hacerlo privado.
