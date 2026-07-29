package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func TestMakeThumbDownscalesAndFits(t *testing.T) {
	// Degradado de 1200x800 para que el promedio por caja tenga algo real que promediar.
	src := image.NewRGBA(image.Rect(0, 0, 1200, 800))
	for y := 0; y < 800; y++ {
		for x := 0; x < 1200; x++ {
			src.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	var in bytes.Buffer
	if err := jpeg.Encode(&in, src, nil); err != nil {
		t.Fatal(err)
	}
	got := makeThumb(in.Bytes())
	if got == "" {
		t.Fatal("no generó miniatura")
	}
	if len(got) > maxThumbBytes {
		t.Fatalf("miniatura de %d bytes, arriba del tope", len(got))
	}
	t.Logf("miniatura: %d bytes de data URI (origen: %d bytes)", len(got), in.Len())

	// El lado mayor debe quedar en thumbMaxPx y la proporción conservarse (1200x800 -> 320x213).
	small := downscale(src, thumbMaxPx)
	b := small.Bounds()
	if b.Dx() != 320 || b.Dy() != 213 {
		t.Fatalf("quedó en %dx%d, se esperaba 320x213", b.Dx(), b.Dy())
	}
}

func TestMakeThumbLeavesSmallAlone(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 100, 50))
	out := downscale(src, thumbMaxPx)
	if out.Bounds() != src.Bounds() {
		t.Fatalf("agrandó una imagen chica: %v", out.Bounds())
	}
}

func TestMakeThumbRejectsGarbage(t *testing.T) {
	if makeThumb([]byte("no soy una imagen")) != "" {
		t.Fatal("aceptó basura")
	}
	if makeThumb(nil) != "" {
		t.Fatal("aceptó nil")
	}
}

func TestThumbMetaHelpers(t *testing.T) {
	if hasThumb("") || hasThumb("{}") || hasThumb("no json") {
		t.Fatal("hasThumb dio verdadero sin miniatura")
	}
	if !hasThumb(`{"thumb":"data:image/jpeg;base64,AAA"}`) {
		t.Fatal("hasThumb no vio la miniatura")
	}
	// Debe conservar w/h al agregarla.
	out := withThumbJSON(`{"w":800,"h":600}`, "X")
	if !hasThumb(out) {
		t.Fatal("no quedó la miniatura")
	}
	if !bytes.Contains([]byte(out), []byte(`"w":800`)) {
		t.Fatalf("perdió w/h: %s", out)
	}
}
