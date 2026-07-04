package main

// At-rest encryption for message bodies — the Go mirror of src/lib/msgcrypto.ts (KEEP IN SYNC).
// AES-256-GCM with a per-tenant subkey HKDF-SHA256(MESSAGE_SECRET_KEY, salt, info=businessID).
// Format: "encm:v1:" + base64(iv[12] | gcmTag[16] | ciphertext) — note the tag sits BEFORE the
// ciphertext (Node's layout); Go's gcm.Seal appends it after, so we reorder on both paths.
// Values without the prefix are legacy plaintext and pass through decryptBody unchanged.
// If MESSAGE_SECRET_KEY is unset we don't encrypt (pass-through) so web/worker never disagree.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"os"
	"strings"

	"golang.org/x/crypto/hkdf"
)

const (
	msgEncPrefix = "encm:v1:"
	msgEncSalt   = "hiraticket-messages"
)

func msgKey(businessID string) []byte {
	secret := os.Getenv("MESSAGE_SECRET_KEY")
	if secret == "" {
		return nil
	}
	key := make([]byte, 32)
	r := hkdf.New(sha256.New, []byte(secret), []byte(msgEncSalt), []byte(businessID))
	if _, err := io.ReadFull(r, key); err != nil {
		return nil
	}
	return key
}

func isEncryptedBody(v string) bool { return strings.HasPrefix(v, msgEncPrefix) }

// encryptBody encrypts a message body for storage. Empty input, missing key, or an
// already-encrypted value pass through unchanged.
func encryptBody(businessID, plain string) string {
	if plain == "" || isEncryptedBody(plain) {
		return plain
	}
	key := msgKey(businessID)
	if key == nil {
		return plain
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return plain
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return plain
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return plain
	}
	sealed := gcm.Seal(nil, iv, []byte(plain), nil) // ciphertext || tag
	ct, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	out := make([]byte, 0, 12+16+len(ct))
	out = append(out, iv...)
	out = append(out, tag...)
	out = append(out, ct...)
	return msgEncPrefix + base64.StdEncoding.EncodeToString(out)
}

// decryptBody decrypts a stored body. Legacy plaintext is returned as-is; failures return "".
func decryptBody(businessID, stored string) string {
	if !isEncryptedBody(stored) {
		return stored
	}
	key := msgKey(businessID)
	if key == nil {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(stored[len(msgEncPrefix):])
	if err != nil || len(raw) < 12+16 {
		return ""
	}
	iv, tag, ct := raw[:12], raw[12:28], raw[28:]
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	sealed := make([]byte, 0, len(ct)+16)
	sealed = append(sealed, ct...)
	sealed = append(sealed, tag...)
	plain, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return ""
	}
	return string(plain)
}
