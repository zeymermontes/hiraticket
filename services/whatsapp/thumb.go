package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	_ "image/png"
	"os"
	"runtime/debug"
	"time"
)

// Miniaturas generadas por nosotros.
//
// WhatsApp manda una miniatura dentro del mensaje, pero solo a veces y solo en los nuevos: los
// mensajes que ya están guardados no la tienen, y sin ella el chat no puede pintar nada hasta bajar
// el archivo completo. Aquí sí podemos generarla —- a diferencia de WhatsApp Web, que no puede
// porque el archivo está cifrado del lado del cliente: nosotros tenemos los bytes en claro.
//
// Sin dependencias nuevas a propósito. jpeg y png se decodifican con la librería estándar, y el
// reescalado es un promedio por caja escrito a mano. Para 320 px la calidad alcanza de sobra y
// evita meter golang.org/x/image al build del contenedor.
//
// Los webp (stickers) no se decodifican, pero tampoco hace falta: ya pesan unos pocos KB.

// thumbMaxPx: lado mayor de la miniatura. Debe coincidir con MAX_PX de src/lib/imageThumb.ts para
// que las fotos que entran y las que salen se vean igual. 320 se veía suave: la burbuja mide hasta
// 240 px de CSS, y en un teléfono a 3x eso son 720 px reales.
const thumbMaxPx = 448

// thumbQuality: 70 es el punto donde bajar más ya no ahorra bytes que importen y sí se nota.
const thumbQuality = 70

// makeThumb devuelve un data URI JPEG con la miniatura de una imagen, o "" si no se pudo.
// Nunca devuelve error: una miniatura es una mejora, no un requisito —- si falla, el mensaje se
// guarda igual y simplemente carga como antes.
func makeThumb(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "" // formato que no sabemos leer (webp, heic, tiff…)
	}
	small := downscale(src, thumbMaxPx)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, small, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return ""
	}
	if buf.Len() > maxThumbBytes {
		return "" // rarísimo a 320px, pero no vale inflar la fila
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

// hasThumb dice si el `meta` que ya se armó trae miniatura (la que manda WhatsApp). Se trabaja
// sobre el JSON ya serializado porque es lo que tiene a mano el flujo de entrada.
func hasThumb(metaJSON string) bool {
	if metaJSON == "" {
		return false
	}
	var m map[string]interface{}
	if json.Unmarshal([]byte(metaJSON), &m) != nil {
		return false
	}
	t, _ := m["thumb"].(string)
	return t != ""
}

// withThumbJSON mete la miniatura en un `meta` ya serializado. Si venía vacío o ilegible, arma uno
// nuevo con solo la miniatura: perder w/h hace que la burbuja use su tamaño por defecto, que es
// mucho mejor que quedarse sin nada que mostrar.
func withThumbJSON(metaJSON, thumb string) string {
	m := map[string]interface{}{}
	if metaJSON != "" {
		_ = json.Unmarshal([]byte(metaJSON), &m)
	}
	m["thumb"] = thumb
	return jsonStr(m)
}

// downscale reduce la imagen para que su lado mayor sea maxPx, promediando los píxeles de cada
// caja de origen. Un muestreo simple (tomar un píxel de cada N) deja las fotos con dientes y
// ruido; el promedio cuesta lo mismo en la práctica y se ve bien.
//
// Si ya es más chica que maxPx se devuelve tal cual: agrandarla no aporta nada y pesa más.
func downscale(src image.Image, maxPx int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return src
	}
	if sw <= maxPx && sh <= maxPx {
		return src
	}
	dw, dh := sw, sh
	if sw >= sh {
		dw = maxPx
		dh = max(1, sh*maxPx/sw)
	} else {
		dh = maxPx
		dw = max(1, sw*maxPx/sh)
	}

	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		y0 := b.Min.Y + y*sh/dh
		y1 := b.Min.Y + (y+1)*sh/dh
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < dw; x++ {
			x0 := b.Min.X + x*sw/dw
			x1 := b.Min.X + (x+1)*sw/dw
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, bl, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA() // 16 bits por canal
					r += uint64(cr)
					g += uint64(cg)
					bl += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			if n == 0 {
				continue
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i+0] = uint8(r / n >> 8)
			dst.Pix[i+1] = uint8(g / n >> 8)
			dst.Pix[i+2] = uint8(bl / n >> 8)
			dst.Pix[i+3] = uint8(a / n >> 8)
		}
	}
	return dst
}

// ---------------------------------------------------------------------------
// Rescate del historial: miniaturas para las fotos que ya estaban guardadas.
// ---------------------------------------------------------------------------

// thumbMaxPixels: tope de píxeles a decodificar. Decodificar deja la imagen en RGBA, 4 bytes por
// píxel, así que una foto de 24 MP son ~96 MB de memoria. En un contenedor de 512 MB corriendo
// whatsmeow eso es la diferencia entre una miniatura y que el worker muera por OOM y se caiga la
// sesión de WhatsApp. 20 MP cubre cualquier foto de teléfono; lo que pase de ahí se salta y se
// registra en el log, para que quede constancia y no parezca que funcionó.
const thumbMaxPixels = 20 * 1000 * 1000

// backfillBatch: cuántas por ronda. Chico a propósito —- esto compite con atender mensajes, y no
// hay ninguna prisa en terminar.
const backfillBatch = 8

// backfillEvery: pausa entre rondas.
const backfillEvery = 30 * time.Second

// backfillThumbs le genera miniatura a los mensajes de imagen que ya están guardados y no la tienen.
//
// Va detrás de una variable de entorno (THUMB_BACKFILL=1) y apagado por defecto: es trabajo pesado
// —- baja el archivo entero y lo decodifica —- y en una instancia chica conviene prenderlo a
// propósito y mirando la memoria, no que arranque solo. Cuando ya no queda nada que hacer, termina
// y no vuelve a correr.
func (m *Manager) backfillThumbs(ctx context.Context) {
	if os.Getenv("THUMB_BACKFILL") != "1" {
		return
	}
	m.log.Infof("thumb backfill: arrancando (THUMB_BACKFILL=1)")
	done, skipped := 0, 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(backfillEvery):
		}

		rows, err := m.db.QueryContext(ctx, `
			SELECT id, media_url, COALESCE(meta::text, '')
			  FROM messages
			 WHERE type = 'image'
			   AND media_url IS NOT NULL
			   AND media_purged_at IS NULL
			   AND ((meta IS NULL OR meta->>'thumb' IS NULL) OR media_size IS NULL)
			 ORDER BY created_at DESC
			 LIMIT $1`, backfillBatch)
		if err != nil {
			m.log.Errorf("thumb backfill query: %v", err)
			return
		}
		type job struct{ id, ref, meta string }
		var jobs []job
		for rows.Next() {
			var j job
			if rows.Scan(&j.id, &j.ref, &j.meta) == nil {
				jobs = append(jobs, j)
			}
		}
		rows.Close()

		if len(jobs) == 0 {
			m.log.Infof("thumb backfill: terminado (%d generadas, %d saltadas)", done, skipped)
			return
		}

		for _, j := range jobs {
			data, _, ferr := m.fetchMedia(ctx, j.ref)
			if ferr != nil || len(data) == 0 {
				// El archivo ya no está (purgado, borrado a mano). Se marca con thumb vacío para no
				// volver a intentarlo cada ronda —- si no, la consulta lo devolvería para siempre y
				// el rescate nunca avanzaría.
				m.exec(ctx, `UPDATE messages SET meta = COALESCE(meta, '{}'::jsonb) || '{"thumb":""}'::jsonb WHERE id = $1`, j.id)
				skipped++
				continue
			}
			t := ""
			if cfg, _, cerr := image.DecodeConfig(bytes.NewReader(data)); cerr == nil && cfg.Width*cfg.Height <= thumbMaxPixels {
				t = makeThumb(data)
			} else if cerr == nil {
				m.log.Infof("thumb backfill: %s saltada, %dx%d es demasiado para decodificar aquí", j.id, cfg.Width, cfg.Height)
			}
			// Aunque la miniatura salga "" se escribe: deja constancia de que ya se intentó. Y de paso
			// se llena media_size, que en los mensajes viejos venía nulo (la columna llegó con 0067):
			// sin el tamaño la interfaz no sabe que la foto es pesada y la carga entera en la burbuja.
			m.exec(ctx, `UPDATE messages
			                SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('thumb', $2::text),
			                    media_size = COALESCE(media_size, $3)
			              WHERE id = $1`, j.id, t, int64(len(data)))
			if t != "" {
				done++
			} else {
				skipped++
			}
			data = nil
		}
		// La memoria de decodificar se devuelve al sistema en vez de quedar en el heap de Go: en una
		// instancia de 512 MB esa diferencia importa.
		debug.FreeOSMemory()
		m.log.Infof("thumb backfill: %d generadas, %d saltadas", done, skipped)
	}
}
