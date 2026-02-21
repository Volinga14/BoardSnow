# Formigal Session AI (PWA v1)

PWA para tracking de esquí/snow en móvil (pensada para Android / Samsung Galaxy S25 Ultra) con:

- GPS track en vivo + mapa
- velocidad (inst/media/máx) con filtro de picos
- desnivel +/-
- runs (bajadas) detectadas (aprox)
- detección aproximada de remonte/paradas
- sensores (acelerómetro/giroscopio)
- saltos estimados (airtime) y posibles impactos/caídas
- timeline unificado (GPS/eventos/notas/media)
- notas de texto y voz
- notas (texto/voz) asociados por timestamp
- resumen final + recap + compartir texto + PNG
- historial, récords, comparación de sesiones, stats por estación/viaje
- export JSON / CSV / GPX
- PWA instalable + offline básico (app shell local)

## Cómo probarla (rápido)
### Opción 1 (simple)
1. Descomprime el ZIP.
2. Abre terminal en la carpeta.
3. Ejecuta:
   - Python: `python -m http.server 8000`
4. Abre en el móvil o PC:
   - `http://localhost:8000` (en el mismo dispositivo)
   - o en el móvil usando la IP local de tu PC: `http://TU_IP:8000`

> Nota: Para GPS/sensores suele funcionar mejor en **HTTPS** o `localhost`. En Android Chrome, local por red puede pedir más permisos/limitaciones. Si quieres, luego lo subimos a GitHub Pages (HTTPS) y va mejor.

### Opción 2 (GitHub Pages)
- Sube el contenido a un repo y publica con GitHub Pages.
- Así tendrás HTTPS y mejor compatibilidad para permisos.

## Limitaciones esperadas (PWA v1)
- Tracking en segundo plano (pantalla apagada / otra app) puede pausarse según navegador.
- Saltos y caídas son **estimaciones** (no métricas certificadas).
- Parte de nieve automático es **beta** (Open-Meteo + estimación). Confirmar siempre con la estación.

## Siguiente paso recomendado (v2)
- Pasar a **Capacitor** para mejor tracking en segundo plano y sensores.
- Integrar Health Connect / más precisión de eventos.
