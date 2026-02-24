# Formigal Session AI (PWA simple)

Versión simplificada para móvil (PWA) enfocada en estabilidad:

- Guardado local automático de sesión activa (se recupera al recargar)
- GPS + velocidad + distancia + desnivel + runs aproximados
- Sensores (acelerómetro/giroscopio) y calibración en el mismo panel
- Historial con mapa y export JSON/CSV/GPX
- Meteo rápida + enlaces a Formigal e Infonieve
- PWA instalable + offline básico

## Uso local

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000`

## GitHub Pages

Ya incluye `.nojekyll` y workflow de Pages.
